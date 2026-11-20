import CoreGraphics
import Testing

@testable import AICore

@Suite("Long screenshot periodic dark-card and wide-sidebar anti-aliasing (H13, H14)")
struct LongScreenshotAntiAliasingTests {
  /// Synthetic `nextjs.org`-like dark-mode page:
  /// - `0..<3600`: distinct hero/feature sections.
  /// - `3600..<5028`: 7 stacked template cards with an exact `204`-row period, `>90%` uniform
  ///   `#000000` background (`informative = false`), repeating `#222` horizontal borders (`0, 1,
  ///   202, 203`) and vertical side borders (`seg 0, 15`), and distinct `3`-segment card titles
  ///   (`seg 2..4`, local rows `24..<46`).
  /// - `5028..<6400`: `"Ready to deploy?"` CTA and footer, clamping at physical bottom `5042`.
  private static func nextjsFrame(
    geometry: LongScreenshotGeometry, position: Int
  ) -> (band: LongScreenshotSignature, area: LongScreenshotSignature) {
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    let head = geometry.headRows.count
    let bandStartInArea = geometry.bandRows.lowerBound - geometry.areaRows.lowerBound
    let areaCount = geometry.areaRows.count
    let bandCount = geometry.bandRows.count

    let blackCell: UInt64 = 0x0000_0000_0001_0001
    let horizBorderCell: UInt64 = 0x2222_2222_AAAA_5555
    let vertBorderLeft: UInt64 = 0x2222_0001_BBBB_1111
    let vertBorderRight: UInt64 = 0x2222_000F_CCCC_9999

    var areaCells = [UInt64](repeating: blackCell, count: areaCount * segments)
    var areaInfo = [Bool](repeating: false, count: areaCount * segments)

    for r in 0..<areaCount {
      let docRow = position + (r - head)
      let rowBase = r * segments
      if (3600..<5028).contains(docRow) {
        let cardIdx = (docRow - 3600) / 204
        let localRow = (docRow - 3600) % 204
        areaCells[rowBase] = vertBorderLeft
        areaInfo[rowBase] = true
        areaCells[rowBase + segments - 1] = vertBorderRight
        areaInfo[rowBase + segments - 1] = true

        if localRow <= 1 || localRow >= 202 {
          for s in 1..<(segments - 1) {
            areaCells[rowBase + s] = horizBorderCell ^ UInt64(localRow * 31 + s)
            areaInfo[rowBase + s] = true
          }
        } else if (24..<46).contains(localRow) {
          for s in 2...4 {
            let u = UInt64(cardIdx * 1_009 + localRow * 37 + s)
            areaCells[rowBase + s] = (u &* 0x9E37_79B9_7F4A_7C15) ^ 0xDEAD_BEEF
            areaInfo[rowBase + s] = true
          }
        }
      } else {
        let u = UInt64(bitPattern: Int64(docRow))
        for s in 0..<segments {
          areaCells[rowBase + s] =
            (u &* 0x9E37_79B9_7F4A_7C15) ^ (UInt64(s + 1) &* 0xBF58_476D_1CE4_E5B9) ^ 0x7F7F
          areaInfo[rowBase + s] = true
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

    let bStart = bandStartInArea * segments
    let bEnd = (bandStartInArea + bandCount) * segments
    let bandSig = LongScreenshotSignature(
      rows: bandCount, segments: segments,
      cells: Array(areaCells[bStart..<bEnd]),
      informative: Array(areaInfo[bStart..<bEnd]),
      columns: colHashes, columnsInformative: colInfo)
    return (bandSig, areaSig)
  }

  /// Synthetic `Next.js Docs` frame (`402 pt` selection over `2,560 pt` `scrollArea`, `8` segments):
  /// - `segments 0..6` (`columns 0..<351`, `~87%`): fixed left sidebar with `41px` nav groups and
  ///   `22px` sub-items (`highlightRow` optionally shifts an active nav pill by `-41`/`-22`/`-1`
  ///   to exercise sidebar self-alias rejection).
  /// - `segment 7` (`columns 351..<402`, `~13%`): scrolling main-docs text column.
  private static func nextjsDocsFrame(
    geometry: LongScreenshotGeometry, position: Int, highlightRow: Int? = nil
  ) -> (band: LongScreenshotSignature, area: LongScreenshotSignature) {
    let cols = geometry.matchedColumns.count
    let segments = LongScreenshotSignature.segmentCount(columns: cols)
    let sidebarCols = cols * (segments - 1) / segments
    let head = geometry.headRows.count
    let bandStart = geometry.bandRows.lowerBound - geometry.areaRows.lowerBound
    let areaCount = geometry.areaRows.count
    let bandCount = geometry.bandRows.count
    let blackCell: UInt64 = 0x0000_0000_0002_0002

    var areaCells = [UInt64](repeating: blackCell, count: areaCount * segments)
    var areaInfo = [Bool](repeating: false, count: areaCount * segments)

    for r in 0..<areaCount {
      let rowBase = r * segments
      let inGroup = r % 41
      let inSub = r % 22
      for s in 0..<(segments - 1) {
        if let hiRow = highlightRow, (hiRow..<(hiRow + 12)).contains(r), (4..<segments - 1) ~= s {
          let pillOffset = r - hiRow
          areaCells[rowBase + s] = 0xABCD_EF00_0000_0000 ^ UInt64(pillOffset * 29 + s)
          areaInfo[rowBase + s] = true
        } else if inGroup < 14 || inSub < 8 {
          // Repeating 41px / 22px sidebar nav stems & tree guides that stay fixed on screen.
          let glyphStem = UInt64((inGroup % 14) * 17 + s * 131)
          areaCells[rowBase + s] = 0x51DE_BA00_0000_0000 ^ glyphStem ^ UInt64(r / 41 == 0 ? 1 : 0)
          areaInfo[rowBase + s] = true
        }
      }
      let docRow = UInt64(bitPattern: Int64(position + (r - head)))
      areaCells[rowBase + segments - 1] =
        (docRow &* 0x9E37_79B9_7F4A_7C15) ^ 0xD0C5_7777_1234_5678
      areaInfo[rowBase + segments - 1] = true
    }

    let colHashes = (0..<cols).map { col -> UInt64 in
      let base = UInt64(col + 1) &* 0x94D0_49BB_1331_11EB
      return col < sidebarCols ? base : (base ^ UInt64(bitPattern: Int64(position + 1)))
    }
    let colInfo = [Bool](repeating: true, count: cols)
    let areaSig = LongScreenshotSignature(
      rows: areaCount, segments: segments, cells: areaCells, informative: areaInfo,
      columns: colHashes, columnsInformative: colInfo)
    let bStart = bandStart * segments
    let bEnd = (bandStart + bandCount) * segments
    let bandSig = LongScreenshotSignature(
      rows: bandCount, segments: segments,
      cells: Array(areaCells[bStart..<bEnd]),
      informative: Array(areaInfo[bStart..<bEnd]),
      columns: colHashes, columnsInformative: colInfo)
    return (bandSig, areaSig)
  }

  @Test("H13: Periodic dark-mode cards never alias by +204/+408 and bottom view stays flush")
  func periodicDarkModeCardsNeverAliasAndBottomViewStaysFlush() throws {
    let selection = CGRect(x: 0, y: 0, width: 759, height: 288)
    let scrollArea = CGRect(x: 0, y: 2, width: 759, height: 1275)
    let display = CGSize(width: 1440, height: 1400)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea, displaySize: display, scale: 1))
    #expect(geometry.bandRows.count == 286)
    #expect(geometry.areaRows.count == 1275)

    let band4100 = Self.nextjsFrame(geometry: geometry, position: 4100).band
    let band4180 = Self.nextjsFrame(geometry: geometry, position: 4180).band
    let band4304 = Self.nextjsFrame(geometry: geometry, position: 4304).band
    if case .moved(let trueOff, _) = LongScreenshotMatcher.match(
      band4180, to: band4100, known: .none)
    {
      #expect(trueOff == 80)
    } else {
      Issue.record("Expected true +80 dark-card band scroll to match")
    }
    #expect(LongScreenshotMatcher.match(band4304, to: band4100, known: .none) == .unmatched)

    let band4637 = Self.nextjsFrame(geometry: geometry, position: 4637).band
    let band4398 = Self.nextjsFrame(geometry: geometry, position: 4398).band
    if case .moved(let off239, _) = LongScreenshotMatcher.match(
      band4398, to: band4637, known: .none)
    {
      #expect(off239 == -239)
    } else {
      Issue.record("Expected band4398 vs band4637 to find true -239 rather than +169 alias")
    }
    let band4367 = Self.nextjsFrame(geometry: geometry, position: 4367).band
    #expect(LongScreenshotMatcher.match(band4367, to: band4637, known: .none) == .unmatched)

    let first = Self.nextjsFrame(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: first.band, firstArea: first.area, scrollValue: nil)
    var prevArea = 0
    var clock = 0.05

    func feed(_ targetPos: Int, dir: LongScreenshotDirection, points: CGFloat) {
      stitch.request(dir, points: points, auto: false, at: clock)
      let f = Self.nextjsFrame(geometry: geometry, position: targetPos)
      _ = stitch.add(f.band, area: f.area, previousAreaPosition: prevArea, at: clock + 0.016)
      if stitch.lost == nil, !stitch.isAdrift { prevArea = stitch.position }
      clock += 0.02
    }

    for pos in stride(from: 400, through: 4800, by: 400) + [5042] {
      feed(pos, dir: .down, points: 400)
    }
    stitch.request(.down, points: 300, auto: false, at: clock)
    _ = stitch.idle(at: clock + 0.55)
    clock += 0.60
    #expect(stitch.position == 5042)
    #expect(stitch.hi == 5328)
    #expect(stitch.reachedEnd)

    stitch.request(.up, points: 667.5, auto: false, at: clock)
    for pos in [5025, 4959, 4806, 4637, 4398, 4050, 3700, 3365] {
      let f = Self.nextjsFrame(geometry: geometry, position: pos)
      _ = stitch.add(f.band, area: f.area, previousAreaPosition: prevArea, at: clock + 0.016)
      #expect(stitch.position == pos)
      prevArea = stitch.position
      clock += 0.018
    }

    for pos in [3800, 4250, 4700, 5042] { feed(pos, dir: .down, points: 450) }
    for pos in [4500, 3900, 3365] { feed(pos, dir: .up, points: 550) }
    for pos in [3838, 4311, 4784, 5042] { feed(pos, dir: .down, points: 473) }

    #expect(stitch.position == 5042)
    #expect(stitch.hi == 5328)
    #expect(stitch.reachedEnd)
    #expect(stitch.layout.height == 5330)
    #expect(stitch.layout.view == 5042..<5330)
    #expect(stitch.layout.view.upperBound == stitch.layout.height)
  }

  @Test(
    "H14: Next.js Docs 85% fixed left sidebar learns statics, rejects -41/-22/-1, and docks at 0")
  func wideFixedSidebarLearnsStaticsRejectsSidebarAliasesAndDocksAtTop() throws {
    let selection = CGRect(x: 0, y: 100, width: 402, height: 213)
    let scrollArea = CGRect(x: 0, y: 0, width: 2560, height: 1290)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea,
        displaySize: CGSize(width: 2560, height: 1440), scale: 1))
    #expect(geometry.matchedColumns == geometry.bandColumns)
    #expect(geometry.matchedColumns == 0..<402)
    #expect(geometry.bandRows.count == 213)

    // Direct band checks with -41, -22, -1 sidebar nav-pill shifts: false aliases must never verify!
    let ref1860 = Self.nextjsDocsFrame(geometry: geometry, position: 1860, highlightRow: 180).band
    for pillShift in [-41, -22, -1] {
      let noOverlap = Self.nextjsDocsFrame(
        geometry: geometry, position: 1530, highlightRow: 180 + pillShift
      ).band
      #expect(LongScreenshotMatcher.match(noOverlap, to: ref1860, known: .none) == .unmatched)
    }
    let step164 = Self.nextjsDocsFrame(
      geometry: geometry, position: 1696, highlightRow: 180 - 41
    ).band
    if case .moved(let off, _) = LongScreenshotMatcher.match(step164, to: ref1860, known: .none) {
      #expect(off == -164)
    } else {
      Issue.record("Expected 15% moving column to match true -164 step despite -41 sidebar pill")
    }

    let first = Self.nextjsDocsFrame(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: first.band, firstArea: first.area, scrollValue: nil)
    var prevArea = 0
    var clock = 0.05
    func step(_ pos: Int, dir: LongScreenshotDirection, points: CGFloat) {
      stitch.request(dir, points: points, auto: false, at: clock)
      let f = Self.nextjsDocsFrame(geometry: geometry, position: pos)
      _ = stitch.add(f.band, area: f.area, previousAreaPosition: prevArea, at: clock + 0.018)
      #expect(stitch.position == pos)
      prevArea = stitch.position
      clock += 0.02
    }

    // 0 -> 1860 -> 0 (-330 flick) -> 1860 -> 0 (-164 flick), then top clamp settle.
    for pos in [300, 650, 1000, 1350, 1700, 1860] { step(pos, dir: .down, points: 350) }
    #expect(stitch.applied.left > geometry.matchedColumns.count * 3 / 4)
    #expect(stitch.hi == 2073)
    for pos in [1530, 1200, 870, 540, 210, 0] { step(pos, dir: .up, points: 330) }
    for pos in [400, 850, 1300, 1750, 1860] { step(pos, dir: .down, points: 450) }
    for pos in [1696, 1532, 1200, 800, 400, 0] { step(pos, dir: .up, points: 260) }

    stitch.request(.up, points: 400, auto: false, at: clock)
    _ = stitch.idle(at: clock + 0.55)
    #expect(stitch.position == 0)
    #expect(stitch.hi == 2073)
    #expect(stitch.reachedStart)
    #expect(stitch.startPosition == 0)
    #expect(stitch.layout.view.lowerBound == 0)
  }

  @Test("H14: reach(.start/.end) reject drifted frameTop/frameBottom and boundary still re-anchors")
  func reachGuardsRejectDriftedFrameBoundsAndBoundaryStillReanchors() throws {
    let selection = CGRect(x: 0, y: 100, width: 402, height: 213)
    let scrollArea = CGRect(x: 0, y: 0, width: 2560, height: 1290)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea,
        displaySize: CGSize(width: 2560, height: 1440), scale: 1))
    let f0 = Self.nextjsDocsFrame(geometry: geometry, position: 0)
    var stitch = LongScreenshotStitch(
      geometry: geometry, first: f0.band, firstArea: f0.area, scrollValue: nil)

    // Grow down to position = 201 (lo == 0, resumeMargin == 71): reach(.start) must reject!
    stitch.request(.down, points: 201, auto: false, at: 0.1)
    let f201 = Self.nextjsDocsFrame(geometry: geometry, position: 201)
    _ = stitch.add(f201.band, area: f201.area, previousAreaPosition: 0, at: 0.12)
    #expect(stitch.position == 201)
    let startAt201 = stitch.reach(.start)
    #expect(startAt201.reached == nil)
    #expect(!stitch.reachedStart)

    // Grow up to position = -500 from a fresh stitch (hi == 213): reach(.end) must reject!
    var upStitch = LongScreenshotStitch(
      geometry: geometry, first: f0.band, firstArea: f0.area, scrollValue: nil)
    upStitch.request(.up, points: 500, auto: false, at: 0.1)
    let fNeg500 = Self.nextjsDocsFrame(geometry: geometry, position: -500)
    _ = upStitch.add(fNeg500.band, area: fNeg500.area, previousAreaPosition: 0, at: 0.12)
    #expect(upStitch.position == -500)
    let endAtNeg500 = upStitch.reach(.end)
    #expect(endAtNeg500.reached == nil)
    #expect(!upStitch.reachedEnd)

    // Boundary re-anchoring: if current drifted to 201 holding f0, upward .still snaps back to 0!
    stitch.current = LongScreenshotStitch.Reference(
      signature: f0.band, area: f0.area, position: 201)
    stitch.request(.up, points: 120, auto: false, at: 0.5)
    _ = stitch.add(f0.band, area: f0.area, previousAreaPosition: 201, at: 0.52)
    #expect(stitch.position == 0)
    _ = stitch.idle(at: 1.05)
    #expect(stitch.reachedStart)
    #expect(stitch.startPosition == 0)
  }
}
