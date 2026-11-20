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
  struct State: Sendable {
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
    /// The latest matched frame's scroll-area pixels and document position, used to bridge strips
    /// seamlessly when a discrete scroll step exceeds a narrow selection band's height.
    var latestArea: (position: Int, rows: LongScreenshotRows)?
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

  /// A locked frame's pixels, valid only during ``receive(_:at:)``.
  struct Frame {
    let base: UnsafeRawPointer
    let bytesPerRow: Int

    func rows(_ rows: Range<Int>, width: Int) -> LongScreenshotRows {
      LongScreenshotRows(copying: rows, of: base, bytesPerRow: bytesPerRow, width: width)
    }
  }

  let geometry: LongScreenshotGeometry
  let scrollValue: Double?
  let state = Mutex(State())
  private let scratch = LongScreenshotScratch()
  let changed: @MainActor @Sendable () -> Void

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
    let hasArea = geometry.areaRows != geometry.bandRows
    let areaSignature =
      hasArea
      ? LongScreenshotSignature.hashing(
        pixels: base, bytesPerRow: bytesPerRow, rows: geometry.areaRows,
        columns: geometry.matchedColumns, scratch: scratch)
      : nil
    let frame = Frame(base: UnsafeRawPointer(base), bytesPerRow: bytesPerRow)
    let prepared = state.withLock { $0.stitch == nil } ? prepareInitial(frame, buffer: buffer) : nil
    var needArea = false
    var needHead = false
    var needTail = false
    var targetPos = 0
    let shouldHop = state.withLock { state -> Bool in
      guard !state.stopped else { return false }
      guard var stitch = state.stitch else {
        let seed = prepared ?? prepareInitial(frame, buffer: buffer)
        start(&state, seed: seed, signature: signature, area: areaSignature)
        return publish(&state)
      }
      let prevPos = stitch.position
      let update = stitch.add(
        signature, area: areaSignature, previousAreaPosition: state.latestArea?.position, at: time)
      ensureImmediateEdges(&state, update: update, stitch: stitch, frame: frame)
      state.stitch = stitch
      apply(update, to: &state, frame: frame)
      let matched = stitch.lost == nil && !stitch.isAdrift
      let moved = matched && stitch.position != prevPos
      needArea = hasArea && matched && state.latestArea?.position != stitch.position
      needHead =
        !stitch.reachedStart && !geometry.headRows.isEmpty && (moved || state.latestHead == nil)
      needTail =
        !stitch.reachedEnd && !geometry.tailRows.isEmpty && (moved || state.latestTail == nil)
      targetPos = stitch.position
      return publish(&state)
    }
    if needArea || needHead || needTail {
      let width = geometry.width
      let nextArea = needArea ? frame.rows(geometry.areaRows, width: width) : nil
      let nextHead = needHead ? frame.rows(geometry.headRows, width: width) : nil
      let nextTail = needTail ? frame.rows(geometry.tailRows, width: width) : nil
      state.withLock { state in
        guard !state.stopped, let cur = state.stitch, cur.position == targetPos else { return }
        if let nextArea { state.latestArea = (targetPos, nextArea) }
        if let nextHead, !cur.reachedStart { state.latestHead = nextHead }
        if let nextTail, !cur.reachedEnd { state.latestTail = nextTail }
      }
    }
    hop(shouldHop)
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
        reachedEnd: stitch.isAtEnd, reachedLimit: stitch.reachedLimit)
    }
  }

  /// Adds the scroll area's part below the selection to the image, or takes it out again.
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
}
