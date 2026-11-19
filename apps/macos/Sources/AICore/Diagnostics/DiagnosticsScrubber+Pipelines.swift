import Foundation

extension DiagnosticsScrubber {
  static func runPipeline(
    rawBytes: Data,
    kind: ScrubKind,
    anchors: EnvironmentAnchors,
    deadlineCpuNs: UInt64
  ) throws -> (Data, Int) {
    try checkDeadline(deadlineCpuNs)
    switch kind {
    case .json:
      return try scrubJsonDocument(
        rawBytes: rawBytes, anchors: anchors, deadlineCpuNs: deadlineCpuNs)
    case .jsonl:
      return try scrubJsonLines(rawBytes: rawBytes, anchors: anchors, deadlineCpuNs: deadlineCpuNs)
    case .plainText:
      return try scrubPlainTextLines(
        rawBytes: rawBytes, anchors: anchors, deadlineCpuNs: deadlineCpuNs)
    }
  }

  private static func scrubJsonDocument(
    rawBytes: Data, anchors: EnvironmentAnchors, deadlineCpuNs: UInt64
  ) throws -> (Data, Int) {
    guard !rawBytes.isEmpty else { throw ScrubberAbortReason.utf8OrJsonInvalid }
    return try autoreleasepool {
      guard
        let root = try? JSONSerialization.jsonObject(with: rawBytes, options: [.fragmentsAllowed])
      else { throw ScrubberAbortReason.utf8OrJsonInvalid }
      var hits = 0
      var stepCounter = 0
      var changed = false
      let scrubbed = try scrubJsonNode(
        root, anchors: anchors, deadlineCpuNs: deadlineCpuNs, stepCounter: &stepCounter,
        hits: &hits, changed: &changed)
      guard JSONSerialization.isValidJSONObject(scrubbed),
        let encoded = try? JSONSerialization.data(withJSONObject: scrubbed, options: [.sortedKeys]),
        !encoded.isEmpty
      else { throw ScrubberAbortReason.utf8OrJsonInvalid }
      try checkDeadline(deadlineCpuNs)
      return (encoded, hits)
    }
  }

  /// Traverses Foundation `NSDictionary`/`NSArray` trees directly without bridging to Swift
  /// `[String: Any]` hash tables unless a secret key or leaf value actually changes (`B3`).
  private static func scrubJsonNode(
    _ node: Any,
    anchors: EnvironmentAnchors,
    deadlineCpuNs: UInt64,
    stepCounter: inout Int,
    hits: inout Int,
    changed: inout Bool
  ) throws -> Any {
    stepCounter &+= 1
    if (stepCounter & 0x3F) == 0 { try checkDeadline(deadlineCpuNs) }

    if let nsDict = node as? NSDictionary {
      var mutated: NSMutableDictionary?
      for (rawKey, value) in nsDict {
        guard let key = rawKey as? String else { continue }
        if DiagnosticsScrubberRules.isSecretKeyName(key) {
          if !(value is NSNull) {
            let copy = mutated ?? NSMutableDictionary(dictionary: nsDict)
            copy[key] = "<redacted>"
            mutated = copy
            hits += 1
            changed = true
          }
        } else if let strVal = value as? String,
          DiagnosticsScrubberFastScan.isSafeStructuralLeaf(key: key, value: strVal)
        {
          continue
        } else {
          var childChanged = false
          let cleanVal = try scrubJsonNode(
            value, anchors: anchors, deadlineCpuNs: deadlineCpuNs, stepCounter: &stepCounter,
            hits: &hits, changed: &childChanged)
          if childChanged {
            let copy = mutated ?? NSMutableDictionary(dictionary: nsDict)
            copy[key] = cleanVal
            mutated = copy
            changed = true
          }
        }
      }
      return mutated ?? nsDict
    }

    if let nsArray = node as? NSArray {
      var mutated: NSMutableArray?
      for idx in 0..<nsArray.count {
        let elem = nsArray.object(at: idx)
        var elemChanged = false
        let cleanElem = try scrubJsonNode(
          elem, anchors: anchors, deadlineCpuNs: deadlineCpuNs, stepCounter: &stepCounter,
          hits: &hits, changed: &elemChanged)
        if elemChanged {
          let copy = mutated ?? NSMutableArray(array: nsArray)
          copy.replaceObject(at: idx, with: cleanElem)
          mutated = copy
          changed = true
        }
      }
      return mutated ?? nsArray
    }

    if let str = node as? String {
      if str.utf8.count <= DiagnosticsScrubberRules.maxLineBytes,
        DiagnosticsScrubberFastScan.mayBeEmbeddedJsonObject(str),
        let nested = try? JSONSerialization.jsonObject(with: Data(str.utf8)),
        nested is NSDictionary
      {
        var rawCopy = str
        let provablyClean = rawCopy.withUTF8 { buf in
          guard let base = buf.baseAddress else { return false }
          return DiagnosticsScrubberJsonFastPath.isProvablyCleanUnescapedJsonBytes(
            base, range: 0..<buf.count, anchors: anchors)
        }
        if provablyClean { return str }

        var nestedChanged = false
        let cleanObj = try scrubJsonNode(
          nested, anchors: anchors, deadlineCpuNs: deadlineCpuNs, stepCounter: &stepCounter,
          hits: &hits, changed: &nestedChanged)
        if !nestedChanged { return str }
        changed = true
        if let cleanData = try? JSONSerialization.data(
          withJSONObject: cleanObj, options: [.sortedKeys])
        {
          return String(decoding: cleanData, as: UTF8.self)
        }
      }
      let (clean, leafHits) = scrubText(str, anchors: anchors)
      hits += leafHits
      if leafHits > 0 || clean != str { changed = true }
      return clean
    }
    return node
  }

  private static func scrubJsonLines(
    rawBytes: Data, anchors: EnvironmentAnchors, deadlineCpuNs: UInt64
  ) throws -> (Data, Int) {
    struct RawFallbackWrapper: Encodable {
      let rawScrubbed: String
      enum CodingKeys: String, CodingKey { case rawScrubbed = "raw_scrubbed" }
    }
    guard !rawBytes.isEmpty else { return (Data(), 0) }
    let lineRanges = DiagnosticsScrubberJsonFastPath.splitLineRanges(rawBytes)
    let encoder = JSONEncoder()
    var output = Data()
    output.reserveCapacity(min(rawBytes.count + 256, 1_048_576))
    var batchJson = Data()
    batchJson.reserveCapacity(64 * 256)
    var batchRanges: [Range<Int>] = []
    batchRanges.reserveCapacity(64)
    var hits = 0
    var stepCounter = 0
    var pemRemaining = 0

    try rawBytes.withUnsafeBytes { rawBuffer in
      guard let base = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
      var batchStart = 0
      while batchStart < lineRanges.count {
        let batchEnd = min(batchStart + 64, lineRanges.count)
        try checkDeadline(deadlineCpuNs)
        try autoreleasepool {
          batchRanges.removeAll(keepingCapacity: true)
          var canBatchParse = pemRemaining == 0
          for lineIdx in batchStart..<batchEnd {
            var r = lineRanges[lineIdx]
            if !r.isEmpty && base[r.upperBound - 1] == 0x0D {
              r = r.lowerBound..<(r.upperBound - 1)
            }
            guard !r.isEmpty else { continue }
            batchRanges.append(r)
            if canBatchParse
              && (r.count > DiagnosticsScrubberRules.maxLineBytes
                || !DiagnosticsScrubberJsonFastPath.isBalancedTopLevelJsonContainer(base, range: r))
            {
              canBatchParse = false
            }
          }
          guard !batchRanges.isEmpty else { return }

          if canBatchParse {
            batchJson.removeAll(keepingCapacity: true)
            batchJson.append(0x5B)  // '['
            for (idx, r) in batchRanges.enumerated() {
              if idx > 0 { batchJson.append(0x2C) }  // ','
              batchJson.append(base.advanced(by: r.lowerBound), count: r.count)
            }
            batchJson.append(0x5D)  // ']'

            if let parsedBatch = (try? JSONSerialization.jsonObject(with: batchJson)) as? NSArray,
              parsedBatch.count == batchRanges.count
            {
              let batchLen = batchJson.count
              batchJson.append(0)
              let wholeBatchClean = batchJson.withUnsafeBytes { buf in
                guard let u8 = buf.baseAddress?.assumingMemoryBound(to: UInt8.self),
                  let cStr = buf.baseAddress?.assumingMemoryBound(to: CChar.self)
                else { return false }
                return DiagnosticsScrubberJsonFastPath.isProvablyCleanNullTerminatedJsonBytes(
                  u8, cString: cStr, count: batchLen, anchors: anchors)
              }
              if wholeBatchClean {
                for r in batchRanges {
                  output.append(base.advanced(by: r.lowerBound), count: r.count)
                  output.append(0x0A)
                }
                return
              }

              for idx in 0..<batchRanges.count {
                let r = batchRanges[idx]
                if DiagnosticsScrubberJsonFastPath.isProvablyCleanUnescapedJsonBytes(
                  base, range: r, anchors: anchors)
                {
                  output.append(base.advanced(by: r.lowerBound), count: r.count)
                  output.append(0x0A)
                  continue
                }
                var lineChanged = false
                let cleanObj = try scrubJsonNode(
                  parsedBatch.object(at: idx), anchors: anchors, deadlineCpuNs: deadlineCpuNs,
                  stepCounter: &stepCounter, hits: &hits, changed: &lineChanged)
                if !lineChanged {
                  output.append(base.advanced(by: r.lowerBound), count: r.count)
                  output.append(0x0A)
                } else {
                  guard
                    let encoded = try? JSONSerialization.data(
                      withJSONObject: cleanObj, options: [.sortedKeys])
                  else { throw ScrubberAbortReason.utf8OrJsonInvalid }
                  output.append(encoded)
                  output.append(0x0A)
                }
              }
              return
            }
          }

          for r in batchRanges {
            let slicePtr = UnsafeBufferPointer(
              start: base.advanced(by: r.lowerBound), count: r.count)
            if pemRemaining > 0 || (base[r.lowerBound] != 0x7B && r.count >= 16) {
              let decoded = String(decoding: slicePtr, as: UTF8.self)
              if let folded = DiagnosticsScrubberFastScan.foldPemLine(
                decoded, remainingSkip: &pemRemaining, hits: &hits)
              {
                output.append(try encoder.encode(RawFallbackWrapper(rawScrubbed: folded)))
                output.append(0x0A)
                continue
              }
              if pemRemaining > 0 { continue }
            }

            let lineData = Data(bytes: base.advanced(by: r.lowerBound), count: r.count)
            if r.count <= DiagnosticsScrubberRules.maxLineBytes,
              let parsed = try? JSONSerialization.jsonObject(with: lineData),
              JSONSerialization.isValidJSONObject(parsed)
            {
              var lineChanged = false
              let cleanObj = try scrubJsonNode(
                parsed, anchors: anchors, deadlineCpuNs: deadlineCpuNs, stepCounter: &stepCounter,
                hits: &hits, changed: &lineChanged)
              if !lineChanged {
                output.append(base.advanced(by: r.lowerBound), count: r.count)
                output.append(0x0A)
              } else {
                guard
                  let encoded = try? JSONSerialization.data(
                    withJSONObject: cleanObj, options: [.sortedKeys])
                else { throw ScrubberAbortReason.utf8OrJsonInvalid }
                output.append(encoded)
                output.append(0x0A)
              }
            } else {
              let decoded = String(decoding: slicePtr, as: UTF8.self)
              let (cleanLine, lineHits) = DiagnosticsScrubberRules.scrubSingleLine(
                decoded, anchors: anchors, enforce4KiBCap: true)
              hits += lineHits
              output.append(try encoder.encode(RawFallbackWrapper(rawScrubbed: cleanLine)))
              output.append(0x0A)
            }
          }
        }
        batchStart = batchEnd
      }
    }
    try checkDeadline(deadlineCpuNs)
    return (output, hits)
  }

  private static func scrubPlainTextLines(
    rawBytes: Data, anchors: EnvironmentAnchors, deadlineCpuNs: UInt64
  ) throws -> (Data, Int) {
    guard !rawBytes.isEmpty else { return (Data(), 0) }
    let lineRanges = DiagnosticsScrubberJsonFastPath.splitLineRanges(rawBytes)
    var output = Data()
    output.reserveCapacity(min(rawBytes.count + 128, 1_048_576))
    var hits = 0
    var pemRemaining = 0
    try rawBytes.withUnsafeBytes { rawBuffer in
      guard let base = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
      for (idx, rawRange) in lineRanges.enumerated() {
        if (idx & 0x3F) == 0 { try checkDeadline(deadlineCpuNs) }
        var r = rawRange
        if !r.isEmpty && base[r.upperBound - 1] == 0x0D {
          r = r.lowerBound..<(r.upperBound - 1)
        }
        let slicePtr = UnsafeBufferPointer(start: base.advanced(by: r.lowerBound), count: r.count)
        let decoded = String(decoding: slicePtr, as: UTF8.self)
        if let folded = DiagnosticsScrubberFastScan.foldPemLine(
          decoded, remainingSkip: &pemRemaining, hits: &hits)
        {
          output.append(contentsOf: folded.utf8)
          if idx < lineRanges.count - 1 { output.append(0x0A) }
          continue
        }
        if pemRemaining > 0 { continue }
        let (clean, lineHits) = DiagnosticsScrubberRules.scrubSingleLine(
          decoded, anchors: anchors, enforce4KiBCap: true)
        hits += lineHits
        output.append(contentsOf: clean.utf8)
        if idx < lineRanges.count - 1 { output.append(0x0A) }
      }
    }
    try checkDeadline(deadlineCpuNs)
    return (output, hits)
  }
}
