import AICore
import Foundation

/// The bounded, structured evidence in a support report. It does not ingest general app logs.
final class DiagnosticRecorder {
  let session = UUID().uuidString
  private var records: [Data] = []
  private var bytes = 0
  private(set) var sequence = 0
  private var dropped = 0
  private var encodingFailures = 0
  private var counts: [String: Int] = [:]
  private var moduleCounts: [String: Int] = [:]

  @discardableResult
  func record(
    _ name: String, module: String, details: [String: JSONValue],
    snapshot: () -> JSONValue = { .null }, correlation: Int? = nil
  ) -> Int {
    sequence += 1
    counts[name, default: 0] += 1
    moduleCounts[module, default: 0] += 1
    let started = ProcessInfo.processInfo.systemUptime
    let state = snapshot()
    let value: JSONValue = .object([
      "session": .string(session), "sequence": .number(Double(sequence)),
      "wallTime": .string(Date.now.ISO8601Format()), "uptime": .number(started),
      "event": .string(name), "module": .string(module),
      "snapshotMs": .number((ProcessInfo.processInfo.systemUptime - started) * 1000),
      "correlation": correlation.map { .number(Double($0)) } ?? .null,
      "details": .object(details), "snapshot": state,
    ])
    do {
      var data = try JSONEncoder().encode(value)
      data.append(0x0A)
      guard data.count <= SupportDiagnosticArchive.byteLimit else {
        dropped += 1
        return sequence
      }
      while !records.isEmpty
        && (records.count >= 3000 || bytes + data.count > SupportDiagnosticArchive.byteLimit)
      {
        bytes -= records.removeFirst().count
        dropped += 1
      }
      records.append(data)
      bytes += data.count
    } catch { encodingFailures += 1 }
    return sequence
  }

  func trace() -> Data {
    var data = Data(capacity: bytes)
    for record in records { data.append(record) }
    return data
  }

  func manifest() -> [String: JSONValue] {
    [
      "schemaVersion": .number(2), "session": .string(session),
      "lastSequence": .number(Double(sequence)),
      "retainedRecords": .number(Double(records.count)),
      "retainedBytes": .number(Double(bytes)),
      "droppedRecords": .number(Double(dropped)),
      "encodingFailures": .number(Double(encodingFailures)),
      "eventCounts": .object(counts.mapValues { .number(Double($0)) }),
      "moduleEventCounts": .object(moduleCounts.mapValues { .number(Double($0)) }),
    ]
  }
}
