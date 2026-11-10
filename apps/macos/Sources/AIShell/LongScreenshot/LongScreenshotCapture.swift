import AICore
import AppKit
@_weakLinked import ScreenCaptureKit

/// The capture engine of one long screenshot's live phase: frames of the selection from one
/// ScreenCaptureKit stream (decision D2), stitched into one tall image while the page scrolls
/// (D3), Atd's own scrolling on request (D4, ``startAutoScroll()``), and the page's ends (D6).
/// No interface: the capture session drives it and shows ``progress``.
///
/// The stream reads the selection's columns over the vertical union of the selection and the
/// scroll area, with Atd's windows left out (desktop pins kept), at the display's own pixels.
/// Each frame's rows that the image lacks are copied out at once, so no frame is held; full
/// chunks of rows are compressed. ``finish()`` puts the image together and ``cancel()`` drops
/// it; after either, nothing of it stays.
@MainActor
final class LongScreenshotCapture {
  struct Target {
    let displayID: CGDirectDisplayID
    /// The display's Quartz frame.
    let displayFrame: CGRect
    /// Display-local view points, origin top-left.
    let selection: CGRect
    /// The scroll area's visible frame, display-local view points.
    let scrollArea: CGRect?
    /// The scroll area's vertical scroll value when Accessibility reported one.
    let scrollValue: Double?
    /// The app under the selection (auto-scroll's target).
    let pid: pid_t?
    let appName: String?
    let windowTitle: String?
  }

  /// Why ``start()`` could not start.
  enum StartError: Error, Equatable {
    /// The Screen Recording grant is missing or no longer matches this build.
    case screenRecordingDenied
    /// The display went, or the selection leaves nothing of it.
    case displayUnavailable
    case failed(String)
  }

  let target: Target
  /// Called on the main actor whenever ``progress`` changes.
  var onChange: ((LongScreenshotProgress) -> Void)?
  /// The stream stopped on its own (permission revoked, display gone); the session ends the
  /// phase. What was stitched can still be finished.
  var onStop: (((any Error)?) -> Void)?
  private(set) var progress: LongScreenshotProgress

  private(set) var engine: LongScreenshotEngine?
  private var stream: SCStream?
  private var output: LongScreenshotStream?
  /// ``start()`` ran, once.
  private var started = false
  /// ``finish()`` or ``cancel()`` ran: nothing more is captured.
  private(set) var ended = false
  var autoScroll: Task<Void, Never>?
  var edgeCheck: Task<Void, Never>?
  private var previewCache: (key: PreviewKey, image: CGImage)?
  private let startedAt = Date()

  init(target: Target) {
    self.target = target
    let screen = target.scrollArea?.height ?? target.selection.height
    progress = LongScreenshotProgress(
      height: target.selection.height, screens: Double(target.selection.height / max(1, screen)))
  }

  /// Adds the scroll area's part below the selection to the image once the page's end offers it
  /// (``LongScreenshotProgress/tail``), or takes it out again.
  func includeTail(_ included: Bool) {
    guard !ended else { return }
    engine?.includeTail(included)
  }

  /// Starts the stream. Throws ``StartError``: `.screenRecordingDenied` when ScreenCaptureKit
  /// refuses for want of the grant (as ``DisplayFreezer/isPermissionError(_:)`` reads it).
  func start() async throws {
    guard !started, !ended else { return }
    started = true
    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: true)
    } catch {
      throw Self.refusal(error)
    }
    guard !ended else { return }
    guard let display = content.displays.first(where: { $0.displayID == target.displayID })
    else { throw StartError.displayUnavailable }
    let filter = RecordingStreamSettings.filter(display: display, content: content, keeping: [])
    guard
      let geometry = LongScreenshotGeometry.make(
        selection: target.selection, scrollArea: target.scrollArea,
        displaySize: target.displayFrame.size, scale: CGFloat(filter.pointPixelScale))
    else { throw StartError.displayUnavailable }
    let engine = LongScreenshotEngine(
      geometry: geometry, scrollValue: target.scrollValue,
      changed: { [weak self] in self?.deliver() })
    let output = LongScreenshotStream(
      engine: engine, onStop: { [weak self] error in self?.streamStopped(error) })
    let stream = SCStream(
      filter: filter, configuration: LongScreenshotStream.configuration(for: geometry),
      delegate: output)
    do {
      try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
    } catch {
      throw Self.refusal(error)
    }
    self.engine = engine
    self.stream = stream
    self.output = output
    do {
      try await stream.startCapture()
    } catch {
      if self.stream === stream { drop() }
      throw Self.refusal(error)
    }
    // Cancelled while the stream started: cancel() already dropped it; stop what it began.
    if ended { try? await stream.stopCapture() }
  }

  /// The stitched image scaled to fit `size` points, at the display's backing scale, for the
  /// preview strip; nil before the first frame. Drawn from thumbnails, and again only when the
  /// image or the size changed.
  func preview(fitting size: CGSize) -> CGImage? {
    guard let engine, let sources = engine.previewSources() else { return nil }
    let key = PreviewKey(
      revision: sources.revision, pieces: sources.layout.pieces, height: sources.layout.height,
      size: size)
    if let previewCache, previewCache.key == key { return previewCache.image }
    let thumbnails = sources.thumbnails
    let image = LongScreenshotRender.preview(
      sources.layout,
      from: LongScreenshotRender.Sources(
        scale: thumbnails.scale, first: sources.first, head: sources.head, tail: sources.tail,
        strips: sources.strips.map { strip in (strip.range, { strip.thumbnail }) }),
      fitting: size, backing: engine.geometry.scale, space: thumbnails.space)
    previewCache = image.map { (key, $0) }
    return image
  }

  /// Stops capturing and composes the image: the display's own pixels, scaled down uniformly to
  /// at most ``LongScreenshotExportRules/maxPixelWidth`` wide (its `scale` then says so); nil
  /// when nothing was captured, or when its memory cannot be had (it is bounded:
  /// ``LongScreenshotGeometry/maxRows``).
  func finish() async -> LongScreenshotImage? {
    guard !ended else { return nil }
    let parts = engine?.take()
    let geometry = engine?.geometry
    let stream = self.stream
    let output = self.output
    end()
    if let stream {
      try? await stream.stopCapture()
      withExtendedLifetime(output) {}
    }
    guard let parts, let geometry,
      let composed = await LongScreenshotRender.compose(parts, pointScale: geometry.scale)
    else { return nil }
    return LongScreenshotImage(
      image: composed.image, scale: composed.scale, appName: target.appName,
      windowTitle: target.windowTitle, capturedAt: startedAt,
      screenHeight: CGFloat(geometry.screenRows) / geometry.scale)
  }

  /// Stops and drops every frame and strip (idempotent).
  func cancel() {
    guard !ended else { return }
    engine?.discard()
    let stream = self.stream
    let output = self.output
    end()
    guard let stream else { return }
    Task {
      try? await stream.stopCapture()
      withExtendedLifetime(output) {}
    }
  }

  // MARK: Private

  private struct PreviewKey: Equatable {
    let revision: Int
    let pieces: [LongScreenshotLayout.Piece]
    let height: Int
    let size: CGSize
  }

  /// Ends the phase on this side: no more frames, scrolling or callbacks into the engine.
  private func end() {
    ended = true
    stopAutoScroll()
    edgeCheck?.cancel()
    edgeCheck = nil
    drop()
  }

  private func drop() {
    engine?.discard()
    engine = nil
    stream = nil
    output = nil
    previewCache = nil
  }

  /// The engine published progress; Atd's own scrolling is this side's to say.
  private func deliver() {
    guard !ended, var next = engine?.takeProgress() else { return }
    next.autoScrolling = autoScroll != nil
    publish(next)
  }

  func publish(_ next: LongScreenshotProgress) {
    guard next != progress else { return }
    progress = next
    onChange?(next)
  }

  private func streamStopped(_ error: any Error) {
    guard !ended else { return }
    stopAutoScroll()
    onStop?(error)
  }

  private static func refusal(_ error: any Error) -> StartError {
    DisplayFreezer.isPermissionError(error)
      ? .screenRecordingDenied : .failed(error.localizedDescription)
  }
}
