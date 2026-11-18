import Foundation

/// Overlap verification and stillness detection for ``LongScreenshotMatcher``.
extension LongScreenshotMatcher {
  /// Whether `offset` explains the moving part's overlap across `movingSegs`: enough agreeing
  /// cells overall, enough agreeing non-invariant informative cells, and enough rows with
  /// informative movement evidence without discarding the sole moving column.
  static func verifies(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, offset: Int,
    region: Range<Int>, movingSegs: Range<Int>
  ) -> Bool {
    let overlap = region.clamped(to: (region.lowerBound - offset)..<(region.upperBound - offset))
    guard overlap.count >= minimumOverlap, frame.segments > 0, !movingSegs.isEmpty else {
      return false
    }
    let segments = frame.segments
    let segLo = movingSegs.lowerBound
    let segHi = movingSegs.upperBound
    var agree = [Int](repeating: 0, count: segments)
    var mismatch = [Int](repeating: 0, count: segments)
    var stayed = [Int](repeating: 0, count: segments)
    var moved = [Int](repeating: 0, count: segments)
    var infoAgree = [Int](repeating: 0, count: segments)
    var infoMismatch = [Int](repeating: 0, count: segments)
    frame.cells.withUnsafeBufferPointer { fcBuf in
      frame.informative.withUnsafeBufferPointer { fiBuf in
        reference.cells.withUnsafeBufferPointer { rcBuf in
          reference.informative.withUnsafeBufferPointer { riBuf in
            let fCells = fcBuf.baseAddress!
            let fInfo = fiBuf.baseAddress!
            let rCells = rcBuf.baseAddress!
            let rInfo = riBuf.baseAddress!
            var row = overlap.lowerBound
            while row < overlap.upperBound {
              let base = row &* segments
              let shiftBase = (row &+ offset) &* segments
              var seg = segLo
              while seg < segHi {
                let idx = base &+ seg
                let shiftIdx = shiftBase &+ seg
                let cell = fCells[idx]
                let sameInPlace = cell == rCells[idx]
                let sameAtOffset = cell == rCells[shiftIdx]
                let anyInfo = fInfo[idx] || rInfo[shiftIdx]
                if fInfo[idx], sameInPlace { stayed[seg] &+= 1 }
                if sameAtOffset {
                  agree[seg] &+= 1
                  if fInfo[idx], !sameInPlace { moved[seg] &+= 1 }
                  if anyInfo, !sameInPlace { infoAgree[seg] &+= 1 }
                } else if !sameInPlace {
                  let occluded = fInfo[shiftIdx] && fCells[shiftIdx] == rCells[shiftIdx]
                  if !occluded {
                    mismatch[seg] &+= 1
                    if anyInfo { infoMismatch[seg] &+= 1 }
                  }
                }
                seg &+= 1
              }
              row &+= 1
            }
          }
        }
      }
    }
    var staticSegs: [Int] = []
    for seg in movingSegs where stayed[seg] >= 2 && stayed[seg] > moved[seg] * 2 {
      staticSegs.append(seg)
    }
    staticSegs.sort { stayed[$0] - mismatch[$0] > stayed[$1] - mismatch[$1] }
    let staticSet = Set(staticSegs.prefix(max(0, movingSegs.count - 1)))
    var movingPool: [Int] = []
    for seg in movingSegs where !staticSet.contains(seg) {
      movingPool.append(seg)
    }
    var pool = movingPool.isEmpty ? Array(movingSegs) : movingPool
    func badness(_ s: Int) -> Int {
      (infoMismatch[s] * 4 + mismatch[s]) - (infoAgree[s] * 4 + agree[s])
    }
    pool.sort { badness($0) < badness($1) }
    var nonStayingSpare = movingPool.count >= 4 && pool.count > 1 ? 1 : 0
    if nonStayingSpare == 1, let candidateDrop = pool.last, moved[candidateDrop] > 0 {
      let othersMoved = pool.dropLast().contains { moved[$0] > 0 }
      if !othersMoved { nonStayingSpare = 0 }
    }
    let active = nonStayingSpare > 0 ? Array(pool.dropLast(nonStayingSpare)) : pool
    var evidenceRows = 0
    var informativeRows = 0
    frame.cells.withUnsafeBufferPointer { fcBuf in
      frame.informative.withUnsafeBufferPointer { fiBuf in
        reference.cells.withUnsafeBufferPointer { rcBuf in
          let fCells = fcBuf.baseAddress!
          let fInfo = fiBuf.baseAddress!
          let rCells = rcBuf.baseAddress!
          var row = overlap.lowerBound
          while row < overlap.upperBound {
            let base = row &* segments
            let shiftBase = (row &+ offset) &* segments
            var evidence = false
            var informative = false
            for seg in active where fInfo[base &+ seg] {
              let cell = fCells[base &+ seg]
              let sameInPlace = cell == rCells[base &+ seg]
              let sameAtOffset = cell == rCells[shiftBase &+ seg]
              if sameAtOffset, !sameInPlace { evidence = true }
              if !(sameInPlace && sameAtOffset) { informative = true }
            }
            if evidence { evidenceRows &+= 1 }
            if informative { informativeRows &+= 1 }
            row &+= 1
          }
        }
      }
    }
    let agreeing = active.reduce(0) { $0 + agree[$1] }
    let checked = agreeing + active.reduce(0) { $0 + mismatch[$1] }
    let keptInfoAgree = active.reduce(0) { $0 + infoAgree[$1] }
    let keptInfoTotal = keptInfoAgree + active.reduce(0) { $0 + infoMismatch[$1] }
    let needed = max(
      minimumEvidenceRows, Int((Double(informativeRows) * minimumEvidenceShare).rounded(.up)))
    return checked > 0 && Double(agreeing) / Double(checked) >= minimumScore
      && keptInfoTotal > 0
      && Double(keptInfoAgree) / Double(keptInfoTotal) >= minimumInformativeScore
      && evidenceRows >= needed
  }

  /// Whether `frame` shows `reference` in place across the active moving segments: most
  /// informative cells unchanged without any moving column scrolling independently, a narrow
  /// localized caret blink on a sparse region, or every cell unchanged when none is informative.
  static func isStill(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature,
    known: Static = .none, minimumInformativeCells: Int = 0
  ) -> Bool {
    guard frame.rows == reference.rows, frame.segments == reference.segments else { return false }
    let rows = frame.rows
    let segments = frame.segments
    guard rows > 0, segments > 0 else { return minimumInformativeCells <= 0 }
    let movingSegs = movingSegments(
      segments: segments, columns: frame.columns.count, known: known)
    let segLo = movingSegs.lowerBound
    let segHi = movingSegs.upperBound
    let maxMismatchedInformative =
      Int((Double(rows * movingSegs.count) * (1.0 - minimumStillShare)).rounded(.up)) + 1
    var informative = 0
    var same = 0
    var changedCells = 0
    var wideChangeRows = 0
    var firstChangedRow = -1
    var lastChangedRow = -1
    var segUnionInfo = [Int](repeating: 0, count: segments)
    var segFrameInfo = [Int](repeating: 0, count: segments)
    var segRefInfo = [Int](repeating: 0, count: segments)
    var segSame = [Int](repeating: 0, count: segments)
    let aborted = frame.cells.withUnsafeBufferPointer { fcBuf in
      frame.informative.withUnsafeBufferPointer { fiBuf in
        reference.cells.withUnsafeBufferPointer { rcBuf in
          reference.informative.withUnsafeBufferPointer { riBuf in
            let fCells = fcBuf.baseAddress!
            let fInfo = fiBuf.baseAddress!
            let rCells = rcBuf.baseAddress!
            let rInfo = riBuf.baseAddress!
            var row = 0
            while row < rows {
              let rowBase = row &* segments
              var seg = segLo
              var rowChanges = 0
              while seg < segHi {
                let idx = rowBase &+ seg
                let equal = fCells[idx] == rCells[idx]
                if !equal {
                  rowChanges &+= 1
                  changedCells &+= 1
                }
                let fi = fInfo[idx]
                let ri = rInfo[idx]
                if fi { segFrameInfo[seg] &+= 1 }
                if ri { segRefInfo[seg] &+= 1 }
                if fi || ri {
                  informative &+= 1
                  segUnionInfo[seg] &+= 1
                  if equal {
                    same &+= 1
                    segSame[seg] &+= 1
                  }
                }
                seg &+= 1
              }
              if rowChanges > 0 {
                if firstChangedRow < 0 { firstChangedRow = row }
                lastChangedRow = row
                if rowChanges > 2 { wideChangeRows &+= 1 }
                if wideChangeRows > 0, informative - same > maxMismatchedInformative {
                  return true
                }
              }
              row &+= 1
            }
            return false
          }
        }
      }
    }
    if aborted || informative < minimumInformativeCells { return false }
    guard informative > 0 else { return changedCells == 0 }
    for seg in movingSegs {
      if segFrameInfo[seg] >= 8, segRefInfo[seg] >= 8, segSame[seg] * 2 < segUnionInfo[seg] {
        return false
      }
    }
    if Double(same) / Double(informative) >= minimumStillShare {
      if wideChangeRows >= 8, Double(same) / Double(informative) < 0.98 { return false }
      return true
    }
    guard segments >= 3, wideChangeRows == 0, firstChangedRow >= 0 else { return false }
    return lastChangedRow - firstChangedRow + 1 <= max(40, rows / 8)
      && changedCells <= max(48, rows / 5)
      && same >= 4
  }
}
