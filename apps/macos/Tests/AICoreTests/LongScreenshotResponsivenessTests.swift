import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Long screenshot responsiveness, reversal recovery, and 1600x16 fallback speed (H12)")
struct LongScreenshotResponsivenessTests {
  private static func framePair(
    geometry: LongScreenshotGeometry, position: Int
  ) -> (band: LongScreenshotSignature, area: LongScreenshotSignature) {
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    let head = geometry.headRows.count
    let areaCount = geometry.areaRows.count
    let bandCount = geometry.bandRows.count

    var areaCells = [UInt64](repeating: 0, count: areaCount * segments)
    let areaInfo = [Bool](repeating: true, count: areaCount * segments)
    areaCells.withUnsafeMutableBufferPointer { ptr in
      for r in 0..<areaCount {
        let doc = UInt64(bitPattern: Int64(position + r - head))
        let base = r * segments
        for s in 0..<segments {
          ptr[base + s] =
            (doc &* 0x9E37_79B9_7F4A_7C15) ^ (UInt64(s + 1) &* 0xBF58_476D_1CE4_E5B9) ^ 0xC3C3
        }
      }
    }
    let colHashes = (0..<cols).map {
      UInt64($0 + 1) &* 0x94D0_49BB_1331_11EB ^ UInt64(bitPattern: Int64(position))
    }
    let colInfo = [Bool](repeating: true, count: cols)
    let areaSig = LongScreenshotSignature(
      rows: areaCount, segments: segments, cells: areaCells, informative: areaInfo,
      columns: colHashes, columnsInformative: colInfo)

    let start = head * segments
    let end = (head + bandCount) * segments
    let bandSig = LongScreenshotSignature(
      rows: bandCount, segments: segments,
      cells: Array(areaCells[start..<end]),
      informative: Array(areaInfo[start..<end]),
      columns: colHashes, columnsInformative: colInfo)
    return (bandSig, areaSig)
  }

  @Test("H12: Stale-position up/down reversal during drift/lost relocks on frame 1")
  func stalePositionUpDownReversalRelocksImmediately() throws {
    let selection = CGRect(x: 0, y: 200, width: 800, height: 300)
    let scrollArea = CGRect(x: 0, y: 0, width: 800, height: 900)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea,
        displaySize: CGSize(width: 1400, height: 1000),
        scale: 1))
    #expect(geometry.bandRows.count == 300)

    let first = Self.framePair(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: first.band, firstArea: first.area, scrollValue: nil)

    var prevArea = 0
    var clock = 0.05
    for pos in stride(from: 250, through: 4500, by: 250) + [4702] {
      stitch.request(.down, points: 250, auto: false, at: clock)
      let f = Self.framePair(geometry: geometry, position: pos)
      _ = stitch.add(f.band, area: f.area, previousAreaPosition: prevArea, at: clock + 0.01)
      prevArea = stitch.position
      clock += 0.03
    }
    #expect(stitch.hi == 5002)

    // Move to 4634, then enter drift/lost near bottom (reproducing Session 2 L2135..L2156).
    stitch.request(.up, points: 68, auto: false, at: clock)
    let at4634 = Self.framePair(geometry: geometry, position: 4634)
    _ = stitch.add(at4634.band, area: at4634.area, previousAreaPosition: prevArea, at: clock + 0.01)
    #expect(stitch.position == 4634)
    clock += 0.05

    stitch.request(.down, points: 180, auto: false, at: clock)
    let overshot = Self.framePair(geometry: geometry, position: 90_000)
    _ = stitch.add(overshot.band, area: overshot.area, previousAreaPosition: 4634, at: clock + 0.02)
    _ = stitch.tick(at: clock + 0.35)
    #expect(stitch.lost == .down)

    // User scrolls UP +457pt, then reverses DOWN -276.5pt (plus a +7.5pt rebound tick) landing at
    // 4344 (delta = -290 < -margin = -100 relative to frozen 4634): must re-lock immediately!
    clock += 0.40
    stitch.request(.up, points: 457.4, auto: false, at: clock)
    stitch.request(.down, points: 276.5, auto: false, at: clock + 0.04)
    stitch.request(.up, points: 7.5, auto: false, at: clock + 0.06)
    let at4344 = Self.framePair(geometry: geometry, position: 4344)
    _ = stitch.add(at4344.band, area: at4344.area, previousAreaPosition: 4634, at: clock + 0.08)
    #expect(stitch.lost == nil)
    #expect(!stitch.isAdrift)
    #expect(stitch.position == 4344)
  }

  @Test("H12: Sub-12pt opposite rebound ticks within 250ms preserve active manual flick")
  func microReboundTicksIgnoredAfterManualFlick() {
    var edges = LongScreenshotEdges(scrollValue: nil)
    let firstAccepted = edges.request(.up, points: 450, auto: false, at: 1.0)
    #expect(firstAccepted)

    // -4.26pt opposite rebound tick 50ms later is ignored.
    let reboundAccepted = edges.request(.down, points: 4.26, auto: false, at: 1.05)
    #expect(!reboundAccepted)
    let kept = edges.recentRequest(at: 1.06)
    #expect(kept?.direction == .up)
    #expect(kept?.burstPoints == 450)
    #expect(kept?.pendingPoints == 450)

    // Intentional >= 12pt reversal is accepted immediately.
    let reversalAccepted = edges.request(.down, points: 24, auto: false, at: 1.10)
    #expect(reversalAccepted)
    let reversed = edges.recentRequest(at: 1.11)
    #expect(reversed?.direction == .down)
    #expect(reversed?.burstPoints == 24)
  }

  @Test("H12: Worst-case 1600x16 unmatched area fallback across 20 waypoints finishes < 25ms")
  func worstCase1600x16UnmatchedFallbackUnder25ms() throws {
    let selection = CGRect(x: 0, y: 200, width: 900, height: 300)
    let scrollArea = CGRect(x: 0, y: 0, width: 900, height: 1600)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea,
        displaySize: CGSize(width: 1600, height: 1800), scale: 1))
    #expect(geometry.areaRows.count == 1600)
    #expect(
      LongScreenshotSignature.segmentCount(columns: geometry.matchedColumns.count) == 16)

    let first = Self.framePair(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: first.band, firstArea: first.area, scrollValue: nil)

    var prevArea = 0
    var clock = 0.05
    for step in 1...20 {
      let pos = step * 250
      stitch.request(.down, points: 250, auto: false, at: clock)
      let f = Self.framePair(geometry: geometry, position: pos)
      _ = stitch.add(f.band, area: f.area, previousAreaPosition: prevArea, at: clock + 0.01)
      prevArea = stitch.position
      clock += 0.02
    }
    #expect(stitch.waypoints.count >= 20)

    let unmatched = Self.framePair(geometry: geometry, position: 500_000)
    stitch.request(.down, points: 120, auto: false, at: clock)
    let t0 = ProcessInfo.processInfo.systemUptime
    _ = stitch.add(
      unmatched.band, area: unmatched.area, previousAreaPosition: prevArea, at: clock + 0.01)
    let elapsedMs = (ProcessInfo.processInfo.systemUptime - t0) * 1000.0
    #expect(stitch.isAdrift)
    #expect(elapsedMs < 25.0, "Expected < 25ms in Debug -Onone, got \(elapsedMs)ms")
  }
}
