import CoreGraphics
import Testing

@testable import AICore

@Suite("Long screenshot auto-scroll, layout view anchoring, and bottom clamp")
struct LongScreenshotAutoScrollTests {
  private static func makeGeometry(
    width: CGFloat = 600, height: CGFloat = 200, scale: CGFloat = 1
  ) throws -> LongScreenshotGeometry {
    let selection = CGRect(x: 0, y: 0, width: width, height: height)
    let display = CGSize(width: 1200, height: 900)
    return try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: selection, displaySize: display, scale: scale))
  }

  /// Deterministic synthetic document slice starting at `topRow`, with unique informative cells per
  /// document row and segment so `LongScreenshotMatcher` verifies exact integer translations.
  private static func pageSignature(
    topRow: Int, rows: Int, segments: Int = 12, columns: Int = 585
  ) -> LongScreenshotSignature {
    var cells = [UInt64](repeating: 0, count: rows * segments)
    var informative = [Bool](repeating: true, count: rows * segments)
    for r in 0..<rows {
      let docRow = UInt64(bitPattern: Int64(topRow + r))
      for s in 0..<segments {
        let index = r * segments + s
        cells[index] =
          (docRow &* 0x9E37_79B9_7F4A_7C15) ^ (UInt64(s + 1) &* 0xBF58_476D_1CE4_E5B9) ^ 0xA5A5
        informative[index] = true
      }
    }
    let colHashes = (0..<columns).map { UInt64($0 + 1) &* 0x94D0_49BB_1331_11EB ^ UInt64(topRow) }
    let colInfo = [Bool](repeating: true, count: columns)
    return LongScreenshotSignature(
      rows: rows, segments: segments, cells: cells, informative: informative, columns: colHashes,
      columnsInformative: colInfo)
  }

  /// Sparse bottom frame with a stationary composer border (`same >= 4`) and an optional 2-segment
  /// caret blink spanning `caretRows` rows.
  private static func sparseBottomSignature(
    rows: Int, segments: Int = 12, columns: Int = 585, caretVisible: Bool,
    caretRange: Range<Int> = 140..<164
  ) -> LongScreenshotSignature {
    var cells = [UInt64](repeating: 0x1111_2222_3333_4444, count: rows * segments)
    var informative = [Bool](repeating: false, count: rows * segments)
    // Stationary composer outline across 8 cells on row 120 so `same >= 4` holds while sparse.
    for s in 2..<10 {
      let idx = 120 * segments + s
      cells[idx] = 0xCAFE_BABE_0000_0000 | UInt64(s)
      informative[idx] = true
    }
    if caretVisible {
      for r in caretRange {
        for s in 3...4 {
          let idx = r * segments + s
          cells[idx] = 0xDEAD_BEEF_1234_0000 | UInt64(r * 16 + s)
          informative[idx] = true
        }
      }
    }
    let colHashes = [UInt64](repeating: 0x5555_6666, count: columns)
    let colInfo = [Bool](repeating: false, count: columns)
    return LongScreenshotSignature(
      rows: rows, segments: segments, cells: cells, informative: informative, columns: colHashes,
      columnsInformative: colInfo)
  }

  @Test("M2: Preview view stays anchored at hi during downward loss instead of jumping backward")
  func viewStaysMonotonicAcrossDownwardLossRecovery() throws {
    let geometry = try Self.makeGeometry(width: 600, height: 200, scale: 1)
    let rows = geometry.bandRows.count
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)

    var stitch = LongScreenshotStitch(
      geometry: geometry,
      first: Self.pageSignature(topRow: 0, rows: rows, segments: segments, columns: cols),
      scrollValue: nil)

    stitch.request(.down, points: 120, auto: false, at: 0.1)
    _ = stitch.add(
      Self.pageSignature(topRow: 120, rows: rows, segments: segments, columns: cols), at: 0.12)
    stitch.request(.down, points: 120, auto: false, at: 0.2)
    _ = stitch.add(
      Self.pageSignature(topRow: 240, rows: rows, segments: segments, columns: cols), at: 0.22)
    #expect(stitch.hi == 440)

    // User scrolls up to 120, then flicks rapidly past 440 into an unmatched region (> resumeMargin
    // pending points so manual overshoot transitions to lost = .down).
    stitch.request(.up, points: 120, auto: false, at: 0.3)
    _ = stitch.add(
      Self.pageSignature(topRow: 120, rows: rows, segments: segments, columns: cols), at: 0.32)
    #expect(stitch.position == 120)

    stitch.request(.down, points: 200, auto: false, at: 0.4)
    _ = stitch.add(
      Self.pageSignature(topRow: 900, rows: rows, segments: segments, columns: cols), at: 0.45)
    _ = stitch.add(
      Self.pageSignature(topRow: 960, rows: rows, segments: segments, columns: cols), at: 0.80)
    #expect(stitch.lost == .down)
    #expect(stitch.position == 120)
    // While lost == .down, view anchors to hi - moving.upperBound (240) rather than frozen 120.
    #expect(stitch.layout.view.lowerBound == 240)

    // Scrolling back up into overlap at 180 moves view monotonically upward (240 -> 180).
    stitch.request(.up, points: 80, auto: false, at: 0.9)
    _ = stitch.add(
      Self.pageSignature(topRow: 180, rows: rows, segments: segments, columns: cols), at: 0.95)
    #expect(stitch.lost == nil)
    #expect(stitch.position == 180)
    #expect(stitch.layout.view.lowerBound == 180)
  }

  @Test("A1 & A2: Fresh pacer stops on downward loss with zero upward steps and restores share")
  func pacerStopsOnDownwardLossAndRestoresSharePastCeiling() {
    var fresh = LongScreenshotAutoScroll(at: 0)
    let lostDown = LongScreenshotAutoScroll.Observation(
      started: true, position: 300, movingRows: 400, scale: 2, lost: .down)
    #expect(fresh.next(lostDown, at: 0.05) == .stop(.lost))

    // Also when downward loss happens immediately after an unmeasured initial downward step.
    var unmeasured = LongScreenshotAutoScroll(at: 0)
    let start = LongScreenshotAutoScroll.Observation(
      started: true, position: 0, movingRows: 400, scale: 2)
    let firstAction = unmeasured.next(start, at: 0.0)
    #expect(firstAction == .scroll(.down, points: 32))
    let lostAfterFirst = LongScreenshotAutoScroll.Observation(
      started: true, position: 0, movingRows: 400, scale: 2, lost: .down)
    #expect(unmeasured.next(lostAfterFirst, at: 0.35) == .stop(.lost))

    // Upward loss recovers downward at minimumShare (0.12), then restores share (0.20) once
    // position passes recoveryCeiling.
    var pacer = LongScreenshotAutoScroll(at: 0)
    let lostUp = LongScreenshotAutoScroll.Observation(
      started: true, position: 0, movingRows: 300, scale: 1, lost: .up)
    #expect(pacer.next(lostUp, at: 0.0) == .scroll(.down, points: 72))

    // Matched at position 0: enters minimumShare (300 * 0.12 = 36pt) with recoveryCeiling = 36.
    let matchedAtZero = LongScreenshotAutoScroll.Observation(
      started: true, position: 0, movingRows: 300, scale: 1)
    #expect(pacer.next(matchedAtZero, at: 0.1) == .scroll(.down, points: 36))

    // Settle at position 30 (<= ceiling 36, gain = 30/36 -> ~0.833): still below ceiling -> 0.12.
    _ = pacer.next(
      LongScreenshotAutoScroll.Observation(started: true, position: 30, movingRows: 300, scale: 1),
      at: 0.2)
    let beforeCeiling = pacer.next(
      LongScreenshotAutoScroll.Observation(started: true, position: 30, movingRows: 300, scale: 1),
      at: 0.45)
    #expect(beforeCeiling == .scroll(.down, points: 43))

    // Advance past ceiling to position 80 (> 36, >= answeredShare): share restores to 0.20!
    let afterCeiling = pacer.next(
      LongScreenshotAutoScroll.Observation(started: true, position: 80, movingRows: 300, scale: 1),
      at: 0.55)
    if case .scroll(let dir, let pts) = afterCeiling {
      #expect(dir == .down)
      #expect(pts > 55)
    } else {
      Issue.record("Expected downward scroll with restored share, got \(afterCeiling)")
    }
  }

  @Test("A3 & A4: Caret blink isStill tolerance and bottom clamp retest converge to reachedEnd")
  func caretBlinkToleranceAndBottomClampConvergence() throws {
    let caretOff = Self.sparseBottomSignature(rows: 320, caretVisible: false)
    let caretOn = Self.sparseBottomSignature(rows: 320, caretVisible: true)
    #expect(LongScreenshotMatcher.isStill(caretOn, caretOff))
    #expect(LongScreenshotMatcher.isStill(caretOff, caretOn))

    let scrolledA = Self.pageSignature(topRow: 0, rows: 320)
    let scrolledB = Self.pageSignature(topRow: 32, rows: 320)
    #expect(!LongScreenshotMatcher.isStill(scrolledB, scrolledA))

    let geometry = try Self.makeGeometry(width: 600, height: 200, scale: 1)
    let rows = geometry.bandRows.count
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)

    var stitch = LongScreenshotStitch(
      geometry: geometry,
      first: Self.pageSignature(topRow: 0, rows: rows, segments: segments, columns: cols),
      scrollValue: nil)

    stitch.request(.down, points: 120, auto: true, at: 0.1)
    _ = stitch.add(
      Self.pageSignature(topRow: 120, rows: rows, segments: segments, columns: cols), at: 0.15)
    #expect(stitch.hi == 320)

    // Final downward step clamps into a sparse composer bottom with a 2Hz blinking caret.
    let bottomOff = Self.sparseBottomSignature(
      rows: rows, segments: segments, columns: cols, caretVisible: false, caretRange: 140..<164)
    let bottomOn = Self.sparseBottomSignature(
      rows: rows, segments: segments, columns: cols, caretVisible: true, caretRange: 140..<164)

    stitch.request(.down, points: 40, auto: true, at: 1.0)
    _ = stitch.add(bottomOff, at: 1.05)
    #expect(stitch.lost == nil)
    #expect(!stitch.reachedEnd)

    // Caret blinks after lostAfter (0.3s) — probe absorbs it without declaring lost = .down.
    _ = stitch.add(bottomOn, at: 1.40)
    _ = stitch.tick(at: 1.45)
    #expect(stitch.lost == nil)
    #expect(!stitch.reachedEnd)

    // Auto-scroll retests downward at 1.55s; bottom stays clamped across caret blink and confirms
    // reachedEnd == true && isAtEnd == true after 0.4s without trimming stripsBelow.
    stitch.request(.down, points: 40, auto: true, at: 1.55)
    _ = stitch.add(bottomOff, at: 1.75)
    let clampedUpdate = stitch.tick(at: 1.96)
    #expect(clampedUpdate.reached == .end)
    #expect(stitch.reachedEnd)
    #expect(stitch.isAtEnd)
    #expect(stitch.lost == nil)
    #expect(stitch.hi == 320)

    // Post-clamp 2Hz caret blinks remain absorbed as still.
    _ = stitch.add(bottomOn, at: 2.45)
    #expect(stitch.isAtEnd)
    #expect(stitch.lost == nil)
  }

  @Test("H10: Reaching start offers headRows without prepending unselected head unless opted in")
  func reachingStartKeepsUnselectedHeadRowsExcludedByDefault() throws {
    let selection = CGRect(x: 0, y: 80, width: 600, height: 200)
    let scrollArea = CGRect(x: 0, y: 0, width: 600, height: 400)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea, displaySize: CGSize(width: 1200, height: 900),
        scale: 1))
    #expect(geometry.headRows == 0..<80)
    #expect(geometry.tailRows == 280..<400)

    let rows = geometry.bandRows.count
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    var stitch = LongScreenshotStitch(
      geometry: geometry,
      first: Self.pageSignature(topRow: 0, rows: rows, segments: segments, columns: cols),
      scrollValue: nil)

    stitch.request(.down, points: 100, auto: false, at: 0.1)
    _ = stitch.add(
      Self.pageSignature(topRow: 100, rows: rows, segments: segments, columns: cols), at: 0.15)
    stitch.request(.up, points: 160, auto: false, at: 0.3)
    _ = stitch.add(
      Self.pageSignature(topRow: 0, rows: rows, segments: segments, columns: cols), at: 0.35)
    stitch.request(.up, points: 80, auto: false, at: 0.4)
    let startUpdate = stitch.idle(at: 0.95)
    #expect(startUpdate.reached == .start)
    #expect(stitch.reachedStart)
    #expect(stitch.offersHead)
    #expect(!stitch.includesHead)
    #expect(!stitch.addedHead)
    #expect(stitch.layout.height == 300)
    #expect(!stitch.layout.pieces.contains(where: { $0.source == .head }))

    stitch.includesHead = true
    #expect(stitch.addedHead)
    #expect(stitch.layout.height == 380)
    #expect(stitch.layout.pieces.contains(where: { $0.source == .head && $0.top == 0 }))
  }

  @Test("H10: Manual scroll bursts preserve burstPoints and reject wrong-way fallback jumps")
  func manualScrollBurstsRejectWrongWayFallbacks() throws {
    let geometry = try Self.makeGeometry(width: 600, height: 200, scale: 1)
    let rows = geometry.bandRows.count
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    func sig(_ top: Int) -> LongScreenshotSignature {
      Self.pageSignature(topRow: top, rows: rows, segments: segments, columns: cols)
    }
    func splice(
      baseTop: Int, dstRows: Range<Int>, from src: LongScreenshotSignature, srcStart: Int
    ) -> LongScreenshotSignature {
      let base = sig(baseTop)
      var cells = base.cells
      for (i, r) in dstRows.enumerated() {
        for s in 0..<segments {
          cells[r * segments + s] = src.cells[(srcStart + i) * segments + s]
        }
      }
      return LongScreenshotSignature(
        rows: rows, segments: segments, cells: cells, informative: base.informative,
        columns: base.columns, columnsInformative: base.columnsInformative)
    }

    let wp198 = splice(baseTop: 198, dstRows: 150..<200, from: sig(9_000), srcStart: 0)
    let wp402 = splice(baseTop: 402, dstRows: 0..<50, from: sig(7_000), srcStart: 0)
    var stitch = LongScreenshotStitch(geometry: geometry, first: sig(0), scrollValue: nil)
    let setupSteps: [(Double, LongScreenshotSignature)] = [
      (0.1, sig(100)), (0.2, wp198), (0.3, sig(270)), (0.4, sig(340)), (0.5, wp402),
      (0.6, sig(480)), (0.7, sig(550)),
    ]
    for (t, frame) in setupSteps {
      stitch.request(.down, points: 100, auto: false, at: t)
      _ = stitch.add(frame, at: t + 0.02)
    }
    #expect(stitch.high.position == 550)

    // Upward burst: 550 -> 480 -> 390 -> 300 clears pending[.up] while burstPoints == 180.
    for (t, pos) in [(0.8, 480), (0.9, 390), (1.0, 300)] {
      stitch.request(.up, points: 60, auto: false, at: t)
      _ = stitch.add(sig(pos), at: t + 0.02)
    }
    #expect(stitch.position == 300)
    let wrongWayDown = splice(baseTop: 50_000, dstRows: 0..<50, from: wp198, srcStart: 150)
    #expect(LongScreenshotMatcher.match(wrongWayDown, to: wp198, known: .none) != .unmatched)
    _ = stitch.add(wrongWayDown, at: 1.06)
    #expect(stitch.position == 300)
    #expect(stitch.isAdrift)

    // Downward burst inside [0, 550]: 252 -> 300 clears pending[.down] while burstPoints == 60.
    stitch.request(.up, points: 50, auto: false, at: 1.2)
    _ = stitch.add(sig(252), at: 1.23)
    stitch.request(.down, points: 60, auto: false, at: 1.4)
    _ = stitch.add(sig(300), at: 1.43)
    #expect(stitch.position == 300)
    let wrongWayUp = splice(baseTop: 60_000, dstRows: 150..<200, from: wp402, srcStart: 0)
    #expect(LongScreenshotMatcher.match(wrongWayUp, to: wp402, known: .none) != .unmatched)
    _ = stitch.add(wrongWayUp, at: 1.46)
    #expect(stitch.position == 300)
    #expect(stitch.isAdrift)
  }
}
