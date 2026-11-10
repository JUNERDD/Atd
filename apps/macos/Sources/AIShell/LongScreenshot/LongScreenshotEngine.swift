import AICore
import CoreGraphics
import CoreVideo
import Foundation
import Synchronization

/// The stitching side of a long screenshot: what frames have shown (``LongScreenshotStitch``)
/// and the pixels kept for the image, behind one lock. Frames arrive on the stream's queue and
/// are copied from while their buffer is locked; requests, ticks, the preview and the end come
/// from the main actor. Progress reaches the main actor through `changed`, coalesced: a hop is
/// scheduled only when the published value changed and none is pending.
nonisolated final class LongScreenshotEngine: Sendable {
  private struct State: Sendable {
    var stitch: LongScreenshotStitch?
    var first: LongScreenshotRows?
    var firstThumbnail: CGImage?
    var strips: LongScreenshotStrips?
    var head: LongScreenshotRows?
    var tail: LongScreenshotRows?
    var headThumbnail: CGImage?
    var tailThumbnail: CGImage?
    /// The latest frame's rows past the band, which become the head or the tail at an edge.
    var latestHead: LongScreenshotRows?
    var latestTail: LongScreenshotRows?
    var thumbnails: LongScreenshotThumbnails?
    var stopped = false
    /// Counts changes to the kept pixels, so an unchanged preview is not drawn again.
    var revision = 0
    var published: LongScreenshotProgress?
    var pending: LongScreenshotProgress?
    var hopping = false
  }

  /// What the preview strip is drawn from.
  struct PreviewSources: Sendable {
    let layout: LongScreenshotLayout
    let revision: Int
    let first: CGImage?
    let head: CGImage?
    let tail: CGImage?
    let strips: [(range: Range<Int>, thumbnail: CGImage?)]
    let thumbnails: LongScreenshotThumbnails
  }

  let geometry: LongScreenshotGeometry
  private let scrollValue: Double?
  private let state = Mutex(State())
  private let scratch = LongScreenshotScratch()
  private let changed: @MainActor @Sendable () -> Void

  init(
    geometry: LongScreenshotGeometry, scrollValue: Double?,
    changed: @escaping @MainActor @Sendable () -> Void
  ) {
    self.geometry = geometry
    self.scrollValue = scrollValue
    self.changed = changed
  }

  /// A complete frame, on the stream's queue. Frames of another size or format are skipped.
  func receive(_ buffer: CVPixelBuffer, at time: Double) {
    guard !state.withLock({ $0.stopped }),
      CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA,
      CVPixelBufferGetWidth(buffer) == geometry.width,
      CVPixelBufferGetHeight(buffer) == geometry.height,
      CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess
    else { return }
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    guard
      let signature = LongScreenshotSignature.hashing(
        pixels: base, bytesPerRow: bytesPerRow, rows: geometry.bandRows,
        columns: geometry.matchedColumns, scratch: scratch)
    else { return }
    let frame = Frame(base: UnsafeRawPointer(base), bytesPerRow: bytesPerRow)
    let space = state.withLock { $0.thumbnails == nil } ? Self.colorSpace(of: buffer) : nil
    hop(
      state.withLock { state in
        guard !state.stopped else { return false }
        guard var stitch = state.stitch else {
          start(&state, frame: frame, signature: signature, space: space)
          return publish(&state)
        }
        cacheEdges(&state, frame: frame, stitch: stitch)
        let update = stitch.add(signature, at: time)
        state.stitch = stitch
        apply(update, to: &state, frame: frame)
        return publish(&state)
      })
  }

  /// A frame ScreenCaptureKit reported as unchanged, on the stream's queue.
  func idle(at time: Double) {
    advance { $0.idle(at: time) }
  }

  /// Time passed without frames: an unanswered request may now show an edge.
  func tick(at time: Double) {
    advance { $0.tick(at: time) }
  }

  func request(
    _ direction: LongScreenshotDirection, points: CGFloat, auto: Bool, at time: Double
  ) {
    state.withLock { $0.stitch?.request(direction, points: points, auto: auto, at: time) }
  }

  /// The progress published since the last call, for the main actor; nil when none is new.
  func takeProgress() -> LongScreenshotProgress? {
    state.withLock { state in
      state.hopping = false
      defer { state.pending = nil }
      return state.pending
    }
  }

  /// What the auto-scroll loop decides on (``LongScreenshotAutoScroll``).
  var autoScrollObservation: LongScreenshotAutoScroll.Observation {
    state.withLock { state in
      guard let stitch = state.stitch else { return .init(started: false) }
      return .init(
        started: true, position: stitch.position, movingRows: stitch.movingRows.count,
        scale: geometry.scale, adrift: stitch.isAdrift, lost: stitch.lost,
        reachedEnd: stitch.reachedEnd, reachedLimit: stitch.reachedLimit)
    }
  }

  /// Adds the scroll area's part below the selection to the image, or takes it out again: the
  /// user's choice, which holds whenever the page's end offers that part (the end can move when
  /// the page loads more).
  func includeTail(_ included: Bool) {
    hop(
      state.withLock { state in
        guard !state.stopped, var stitch = state.stitch, stitch.includesTail != included
        else { return false }
        stitch.includesTail = included
        state.stitch = stitch
        return publish(&state)
      })
  }

  func previewSources() -> PreviewSources? {
    state.withLock { state in
      guard let stitch = state.stitch, let thumbnails = state.thumbnails else { return nil }
      return PreviewSources(
        layout: stitch.layout, revision: state.revision, first: state.firstThumbnail,
        head: state.headThumbnail, tail: state.tailThumbnail,
        strips: (state.strips?.chunks ?? []).map { ($0.range, $0.thumbnail) },
        thumbnails: thumbnails)
    }
  }

  /// Stops taking frames and moves every kept pixel out, for the final image; nil before the
  /// first frame. Nothing stays behind.
  func take() -> LongScreenshotRender.Parts? {
    state.withLock { state in
      defer { state = State(stopped: true) }
      guard let stitch = state.stitch, let first = state.first,
        let space = state.thumbnails?.space
      else { return nil }
      return LongScreenshotRender.Parts(
        layout: stitch.layout, first: first, head: state.head, tail: state.tail,
        strips: state.strips?.chunks ?? [], space: space)
    }
  }

  /// Stops taking frames and drops every pixel.
  func discard() {
    state.withLock { $0 = State(stopped: true) }
  }

  // MARK: Under the lock

  /// A locked frame's pixels, valid only during ``receive(_:at:)``.
  private struct Frame {
    let base: UnsafeRawPointer
    let bytesPerRow: Int

    func rows(_ rows: Range<Int>, width: Int) -> LongScreenshotRows {
      LongScreenshotRows(copying: rows, of: base, bytesPerRow: bytesPerRow, width: width)
    }
  }

  private func start(
    _ state: inout State, frame: Frame, signature: LongScreenshotSignature, space: CGColorSpace?
  ) {
    let thumbnails = LongScreenshotThumbnails(
      width: geometry.width, space: space ?? CGColorSpaceCreateDeviceRGB())
    let first = frame.rows(0..<geometry.height, width: geometry.width)
    let stitch = LongScreenshotStitch(
      geometry: geometry, first: signature, scrollValue: scrollValue)
    state.thumbnails = thumbnails
    state.first = first
    state.firstThumbnail = thumbnails.make(first)
    state.strips = LongScreenshotStrips(width: geometry.width, thumbnails: thumbnails)
    cacheEdges(&state, frame: frame, stitch: stitch)
    state.stitch = stitch
    state.revision += 1
  }

  /// Keeps this frame's rows past the band for as long as that edge may still be reached.
  private func cacheEdges(_ state: inout State, frame: Frame, stitch: LongScreenshotStitch) {
    if !stitch.reachedStart, !geometry.headRows.isEmpty {
      state.latestHead = frame.rows(geometry.headRows, width: geometry.width)
    }
    if !stitch.reachedEnd, !geometry.tailRows.isEmpty {
      state.latestTail = frame.rows(geometry.tailRows, width: geometry.width)
    }
  }

  private func advance(_ step: (inout LongScreenshotStitch) -> LongScreenshotStitch.Update) {
    hop(
      state.withLock { state in
        guard !state.stopped, var stitch = state.stitch else { return false }
        let update = step(&stitch)
        state.stitch = stitch
        apply(update, to: &state, frame: nil)
        return publish(&state)
      })
  }

  /// Copies the rows `update` asks for out of `frame` (none without one), trims what an edge
  /// cut, and keeps the head or tail when an edge was reached.
  private func apply(_ update: LongScreenshotStitch.Update, to state: inout State, frame: Frame?) {
    guard !update.isEmpty, let stitch = state.stitch, var strips = state.strips else { return }
    let width = geometry.width
    if let frame, let rows = update.above.flatMap(streamRows),
      let top = stitch.stripsAbove?.lowerBound
    {
      strips.prepend(frame.rows(rows, width: width), top: top)
    }
    if let frame, let rows = update.below.flatMap(streamRows),
      let bottom = stitch.stripsBelow?.upperBound
    {
      strips.append(frame.rows(rows, width: width), top: bottom - rows.count)
    }
    if update.keepFrom != nil || update.keepBefore != nil {
      strips.keep(above: stitch.stripsAbove, below: stitch.stripsBelow)
    }
    state.strips = strips
    if update.dropsHead {
      state.head = nil
      state.headThumbnail = nil
    }
    if update.dropsTail {
      state.tail = nil
      state.tailThumbnail = nil
    }
    if update.reached == .start, stitch.addedHead, let rows = state.latestHead {
      state.head = rows
      state.headThumbnail = state.thumbnails?.make(rows)
      state.latestHead = nil
    }
    if update.reached == .end, stitch.offersTail, let rows = state.latestTail {
      state.tail = rows
      state.tailThumbnail = state.thumbnails?.make(rows)
      state.latestTail = nil
    }
    state.revision += 1
  }

  /// The stream rows of band rows `rows`; nil, so nothing is copied, unless they lie inside the
  /// band. The stitch only asks for rows of the band's moving part; this keeps any slip from
  /// reading outside the frame's buffer.
  private func streamRows(_ rows: Range<Int>) -> Range<Int>? {
    let band = geometry.bandRows
    guard !rows.isEmpty, rows.lowerBound >= 0, rows.upperBound <= band.count else { return nil }
    return (band.lowerBound + rows.lowerBound)..<(band.lowerBound + rows.upperBound)
  }

  /// Records the progress as it stands; true when a hop to the main actor must be scheduled.
  private func publish(_ state: inout State) -> Bool {
    guard let stitch = state.stitch else { return false }
    let layout = stitch.layout
    let scale = geometry.scale
    let progress = LongScreenshotProgress(
      height: CGFloat(layout.height) / scale, screens: geometry.screens(layout.height),
      lost: stitch.lost, reachedEnd: stitch.reachedEnd, reachedStart: stitch.reachedStart,
      reachedLimit: stitch.reachedLimit,
      view: CGFloat(layout.view.lowerBound) / scale...CGFloat(layout.view.upperBound) / scale,
      scrolled: stitch.scrolled,
      tail: stitch.offersTail ? (stitch.includesTail ? .included : .excluded) : .none)
    guard progress != state.published else { return false }
    state.published = progress
    state.pending = progress
    guard !state.hopping else { return false }
    state.hopping = true
    return true
  }

  private func hop(_ needed: Bool) {
    guard needed else { return }
    let changed = changed
    Task { @MainActor in changed() }
  }

  /// The colour space ScreenCaptureKit tagged the frame with: the display's, as screenshots
  /// use. Nil when untagged.
  private static func colorSpace(of buffer: CVPixelBuffer) -> CGColorSpace? {
    guard let attachments = CVBufferCopyAttachments(buffer, .shouldPropagate) else { return nil }
    return CVImageBufferCreateColorSpaceFromAttachments(attachments)?.takeRetainedValue()
  }
}
