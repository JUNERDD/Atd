import CoreGraphics
import Testing

@testable import AICore

@Suite("Long screenshot extended scroll-area matching and gapless strip bridging (H11)")
struct LongScreenshotAreaBridgeTests {
  /// Synthetic frame pair `(band, area)` for a document scrolled to `position` (`0` at frame 0),
  /// with optional stationary sticky rows at the top and bottom of `areaRows`.
  private static func framePair(
    geometry: LongScreenshotGeometry, position: Int, stickyTop: Int = 0, stickyBottom: Int = 0
  ) -> (band: LongScreenshotSignature, area: LongScreenshotSignature) {
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    let head = geometry.headRows.count
    let areaCount = geometry.areaRows.count
    let bandCount = geometry.bandRows.count

    func rowHash(_ key: Int, segment: Int) -> UInt64 {
      let u = UInt64(bitPattern: Int64(key))
      return (u &* 0x9E37_79B9_7F4A_7C15) ^ (UInt64(segment + 1) &* 0xBF58_476D_1CE4_E5B9) ^ 0x5A5A
    }

    var areaCells = [UInt64](repeating: 0, count: areaCount * segments)
    let areaInfo = [Bool](repeating: true, count: areaCount * segments)
    for r in 0..<areaCount {
      let key: Int =
        if r < stickyTop {
          -1_000_000 - r
        } else if r >= areaCount - stickyBottom {
          2_000_000 + r
        } else {
          position + (r - head)
        }
      for s in 0..<segments {
        areaCells[r * segments + s] = rowHash(key, segment: s)
      }
    }
    let colHashes = (0..<cols).map {
      UInt64($0 + 1) &* 0x94D0_49BB_1331_11EB ^ UInt64(bitPattern: Int64(position))
    }
    let colInfo = [Bool](repeating: true, count: cols)
    let areaSig = LongScreenshotSignature(
      rows: areaCount, segments: segments, cells: areaCells, informative: areaInfo,
      columns: colHashes, columnsInformative: colInfo)

    let bandStart = head * segments
    let bandEnd = (head + bandCount) * segments
    let bandSig = LongScreenshotSignature(
      rows: bandCount, segments: segments,
      cells: Array(areaCells[bandStart..<bandEnd]),
      informative: Array(areaInfo[bandStart..<bandEnd]),
      columns: colHashes, columnsInformative: colInfo)
    return (bandSig, areaSig)
  }

  @Test("H11: Narrow 203-row selection bridges 240..480-row discrete wheel jumps gaplessly")
  func round2NarrowSelectionDiscreteWheelJumps() throws {
    let selection = CGRect(x: 0, y: 150, width: 600, height: 203)
    let scrollArea = CGRect(x: 0, y: 0, width: 600, height: 600)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea, displaySize: CGSize(width: 1200, height: 900),
        scale: 1))
    #expect(geometry.bandRows.count == 203)
    #expect(geometry.headRows == 0..<150)
    #expect(geometry.tailRows == 353..<600)

    let first = Self.framePair(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: first.band, firstArea: first.area, scrollValue: nil)

    var prevAreaPos = 0
    var coveredBelow: [Range<Int>] = []
    var clock = 0.1

    func step(_ targetPos: Int) {
      let delta = targetPos - stitch.position
      stitch.request(delta >= 0 ? .down : .up, points: CGFloat(abs(delta)), auto: false, at: clock)
      let pair = Self.framePair(geometry: geometry, position: targetPos)
      let update = stitch.add(
        pair.band, area: pair.area, previousAreaPosition: prevAreaPos, at: clock + 0.02)
      #expect(stitch.lost == nil)
      #expect(!stitch.isAdrift)
      #expect(stitch.position == targetPos)
      if let prevBelow = update.previousBelow {
        coveredBelow.append(
          (prevAreaPos + prevBelow.lowerBound)..<(prevAreaPos + prevBelow.upperBound))
      }
      if let curBelow = update.below {
        coveredBelow.append((targetPos + curBelow.lowerBound)..<(targetPos + curBelow.upperBound))
      }
      prevAreaPos = stitch.position
      clock += 0.05
    }

    // Discrete 2-4 notch downward wheel jumps (240, 360, 480 > bandRows 203!).
    for pos in [240, 600, 1080, 1440] { step(pos) }
    #expect(stitch.hi == 1440 + 203)

    // Scroll all the way back up in 480-row jumps, pause >= 0.5s at 0, then jump down to 1800.
    for pos in [960, 480, 0] { step(pos) }
    stitch.request(.up, points: 240, auto: false, at: clock)
    let startUpdate = stitch.idle(at: clock + 0.55)
    #expect(startUpdate.reached == .start)
    #expect(stitch.reachedStart)
    #expect(!stitch.addedHead)
    clock += 0.60

    for pos in [480, 960, 1440, 1800] { step(pos) }

    // Verify 100% contiguous, non-overlapping strip coverage from 203..<2003 and strict selection bounds.
    var cursor = 203
    for span in coveredBelow {
      #expect(!span.isEmpty)
      #expect(span.lowerBound == cursor)
      cursor = span.upperBound
    }
    #expect(cursor == 2003)
    #expect(stitch.lo == 0)
    #expect(stitch.hi == 2003)
    #expect(!stitch.addedHead)
    #expect(!stitch.addedTail)
    #expect(stitch.layout.height == 2003)
  }

  @Test("H11: Dual-frame bridging covers downward and upward jumps and rejects genuine gaps")
  func dualFrameBridgingDownAndUpAndGapRejection() throws {
    // 1. Downward jump with small headRows (20 rows) and 360-row jump: requires previousBelow + below.
    let downGeo = try #require(
      LongScreenshotGeometry.make(
        selection: CGRect(x: 0, y: 20, width: 600, height: 203),
        scrollArea: CGRect(x: 0, y: 0, width: 600, height: 600),
        displaySize: CGSize(width: 1200, height: 900), scale: 1))
    #expect(downGeo.headRows.count == 20)
    #expect(downGeo.tailRows.count == 377)

    let down0 = Self.framePair(geometry: downGeo, position: 0)
    var downStitch = LongScreenshotStitch(
      geometry: downGeo, first: down0.band, firstArea: down0.area, scrollValue: nil)
    downStitch.request(.down, points: 360, auto: false, at: 0.1)
    let down360 = Self.framePair(geometry: downGeo, position: 360)
    let downUpdate = downStitch.add(
      down360.band, area: down360.area, previousAreaPosition: 0, at: 0.13)
    #expect(downStitch.lost == nil)
    #expect(downStitch.position == 360)
    #expect(downUpdate.previousBelow == 203..<340)
    #expect(downUpdate.below == -20..<203)
    #expect(downStitch.stripsBelow == 203..<563)

    // Genuine gap (> areaRows): jumping from 360 -> 1100 (curDoc starts at 1080 > prevDoc end 940).
    downStitch.request(.down, points: 740, auto: false, at: 0.3)
    let gapPair = Self.framePair(geometry: downGeo, position: 1100)
    _ = downStitch.add(gapPair.band, area: gapPair.area, previousAreaPosition: 360, at: 0.33)
    #expect(downStitch.hi == 563)

    // 2. Upward jump with small tailRows (20 rows) and -360-row jump: requires previousAbove + above.
    let upGeo = try #require(
      LongScreenshotGeometry.make(
        selection: CGRect(x: 0, y: 377, width: 600, height: 203),
        scrollArea: CGRect(x: 0, y: 0, width: 600, height: 600),
        displaySize: CGSize(width: 1200, height: 900), scale: 1))
    #expect(upGeo.headRows.count == 377)
    #expect(upGeo.tailRows.count == 20)

    let up0 = Self.framePair(geometry: upGeo, position: 0)
    var upStitch = LongScreenshotStitch(
      geometry: upGeo, first: up0.band, firstArea: up0.area, scrollValue: nil)
    upStitch.request(.up, points: 360, auto: false, at: 0.1)
    let upNeg360 = Self.framePair(geometry: upGeo, position: -360)
    let upUpdate = upStitch.add(
      upNeg360.band, area: upNeg360.area, previousAreaPosition: 0, at: 0.13)
    #expect(upStitch.lost == nil)
    #expect(upStitch.position == -360)
    #expect(upUpdate.previousAbove == -137..<0)
    #expect(upUpdate.above == 0..<223)
    #expect(upStitch.stripsAbove == -360..<0)
    #expect(upStitch.lo == -360)
    #expect(upStitch.hi == 203)
  }

  @Test("H11: Sticky navbar and composer in headRows/tailRows are excluded from bridged strips")
  func stickyAreaEdgesExcludedAndMovingRowsStayBandScoped() throws {
    let geo = try #require(
      LongScreenshotGeometry.make(
        selection: CGRect(x: 0, y: 150, width: 600, height: 203),
        scrollArea: CGRect(x: 0, y: 0, width: 600, height: 600),
        displaySize: CGSize(width: 1200, height: 900), scale: 1))
    let f0 = Self.framePair(geometry: geo, position: 0, stickyTop: 60, stickyBottom: 80)
    var stitch = LongScreenshotStitch(
      geometry: geo, first: f0.band, firstArea: f0.area, scrollValue: nil)

    stitch.request(.down, points: 300, auto: false, at: 0.1)
    let f300 = Self.framePair(geometry: geo, position: 300, stickyTop: 60, stickyBottom: 80)
    let u = stitch.add(f300.band, area: f300.area, previousAreaPosition: 0, at: 0.13)
    #expect(stitch.lost == nil)
    #expect(stitch.movingRows == 0..<203)
    #expect(stitch.areaMovingInBand == -90..<370)
    // With stickyTop = 60, curDoc starts at 300 - 90 = 210 > 203, so 203..<210 comes from prevArea
    // (well above stickyBottom at 370) and 210..<503 comes from current -90..<203 (excluding 0..<60 navbar!).
    #expect(u.previousBelow == 203..<210)
    #expect(u.below == -90..<203)
    #expect(stitch.hi == 503)
  }
}
