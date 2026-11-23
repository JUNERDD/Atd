import AICore
import CoreGraphics
import CoreVideo
import Foundation
import Synchronization

nonisolated extension LongScreenshotEngine {
  struct InitialSeed {
    let thumbnails: LongScreenshotThumbnails
    let first: LongScreenshotRows
    let firstThumbnail: CGImage?
    let area: LongScreenshotRows?
    let head: LongScreenshotRows?
    let tail: LongScreenshotRows?
  }

  /// Copies initial frame buffers and renders the first thumbnail outside `state.withLock`.
  func prepareInitial(_ frame: Frame, buffer: CVPixelBuffer) -> InitialSeed {
    let space = Self.colorSpace(of: buffer) ?? CGColorSpaceCreateDeviceRGB()
    let thumbnails = LongScreenshotThumbnails(width: geometry.width, space: space)
    let width = geometry.width
    let first = frame.rows(0..<geometry.height, width: width)
    let firstThumbnail = thumbnails.make(first)
    let area =
      geometry.measuresArea ? frame.rows(geometry.areaRows, width: width) : nil
    let head = !geometry.headRows.isEmpty ? frame.rows(geometry.headRows, width: width) : nil
    let tail = !geometry.tailRows.isEmpty ? frame.rows(geometry.tailRows, width: width) : nil
    return InitialSeed(
      thumbnails: thumbnails, first: first, firstThumbnail: firstThumbnail, area: area, head: head,
      tail: tail)
  }

  func start(
    _ state: inout State, seed: InitialSeed, signature: LongScreenshotSignature,
    area: LongScreenshotSignature?
  ) {
    let stitch = LongScreenshotStitch(
      geometry: geometry, first: signature, firstArea: area, scrollValue: scrollValue)
    state.thumbnails = seed.thumbnails
    state.first = seed.first
    state.firstThumbnail = seed.firstThumbnail
    state.strips = LongScreenshotStrips(width: geometry.width, thumbnails: seed.thumbnails)
    if let seedArea = seed.area { state.latestArea = (0, seedArea) }
    state.latestHead = seed.head
    state.latestTail = seed.tail
    state.stitch = stitch
    state.revision += 1
  }

  /// Ensures `latestHead`/`latestTail` are populated if `stitch.add` reached an edge synchronously.
  func ensureImmediateEdges(
    _ state: inout State, update: LongScreenshotStitch.Update, stitch: LongScreenshotStitch,
    frame: Frame
  ) {
    if update.reached == .start, stitch.offersHead, state.latestHead == nil,
      !geometry.headRows.isEmpty
    {
      state.latestHead = frame.rows(geometry.headRows, width: geometry.width)
    }
    if update.reached == .end, stitch.offersTail, state.latestTail == nil,
      !geometry.tailRows.isEmpty
    {
      state.latestTail = frame.rows(geometry.tailRows, width: geometry.width)
    }
  }

  func advance(_ step: (inout LongScreenshotStitch) -> LongScreenshotStitch.Update) {
    hop(
      state.withLock { state in
        guard !state.stopped, var stitch = state.stitch else { return false }
        let update = step(&stitch)
        state.stitch = stitch
        apply(update, to: &state, frame: nil)
        return publish(&state)
      })
  }

  /// Copies the rows `update` asks for out of `frame` and `latestArea`, trims what an edge cut,
  /// and keeps the head or tail when an edge was reached.
  func apply(_ update: LongScreenshotStitch.Update, to state: inout State, frame: Frame?) {
    guard !update.isEmpty, let stitch = state.stitch, var strips = state.strips else { return }
    let width = geometry.width
    let totalAbove = (update.previousAbove?.count ?? 0) + (update.above?.count ?? 0)
    if let startTop = stitch.stripsAbove?.lowerBound, totalAbove > 0 {
      var cursor = startTop + totalAbove
      if let prevRange = update.previousAbove,
        let prevSlice = latestAreaSlice(prevRange, state: state)
      {
        cursor -= prevSlice.count
        strips.prepend(prevSlice, top: cursor)
      }
      if let curRange = update.above, let frame, let stream = areaStreamRows(curRange) {
        let curSlice = frame.rows(stream, width: width)
        cursor -= curSlice.count
        strips.prepend(curSlice, top: cursor)
      }
    }
    let totalBelow = (update.previousBelow?.count ?? 0) + (update.below?.count ?? 0)
    if let end = stitch.stripsBelow?.upperBound, totalBelow > 0 {
      var cursor = end - totalBelow
      if let prevRange = update.previousBelow,
        let prevSlice = latestAreaSlice(prevRange, state: state)
      {
        strips.append(prevSlice, top: cursor)
        cursor += prevSlice.count
      }
      if let curRange = update.below, let frame, let stream = areaStreamRows(curRange) {
        strips.append(frame.rows(stream, width: width), top: cursor)
      }
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
    if update.reached == .start, stitch.offersHead, let rows = state.latestHead {
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

  /// Stream rows for band-relative `rows` bounded within ``LongScreenshotGeometry/areaRows``.
  func areaStreamRows(_ rows: Range<Int>) -> Range<Int>? {
    let band = geometry.bandRows
    let area = geometry.areaRows
    let stream = (band.lowerBound + rows.lowerBound)..<(band.lowerBound + rows.upperBound)
    guard !stream.isEmpty, stream.lowerBound >= area.lowerBound,
      stream.upperBound <= area.upperBound
    else { return nil }
    return stream
  }

  /// Slice of `state.latestArea` for band-relative `rows` (`0` at `bandRows.lowerBound`).
  func latestAreaSlice(_ rows: Range<Int>, state: State) -> LongScreenshotRows? {
    guard let latest = state.latestArea, !rows.isEmpty else { return nil }
    let head = geometry.headRows.count
    let local = (rows.lowerBound + head)..<(rows.upperBound + head)
    guard local.lowerBound >= 0, local.upperBound <= latest.rows.count else { return nil }
    return latest.rows.slice(local)
  }

  /// Records the progress as it stands; true when a hop to the main actor must be scheduled.
  func publish(_ state: inout State) -> Bool {
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

  func hop(_ needed: Bool) {
    guard needed else { return }
    let changed = changed
    Task { @MainActor in changed() }
  }

  /// The colour space ScreenCaptureKit tagged the frame with: the display's, as screenshots
  /// use. Nil when untagged.
  static func colorSpace(of buffer: CVPixelBuffer) -> CGColorSpace? {
    guard let attachments = CVBufferCopyAttachments(buffer, .shouldPropagate) else { return nil }
    return CVImageBufferCreateColorSpaceFromAttachments(attachments)?.takeRetainedValue()
  }
}
