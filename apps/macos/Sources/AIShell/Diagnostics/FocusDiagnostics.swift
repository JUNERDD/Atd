import AICore
import AppKit
import ApplicationServices

/// Opt-in at build time, so shipped builds do not install monitors or touch diagnostic files.
final class FocusDiagnostics {
  static let shared = FocusDiagnostics()
  static var enabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "AtdFocusDiagnostics") as? String == "YES"
  }

  let session = UUID().uuidString
  private let archive = FocusDiagnosticArchive()
  private var monitoring: FocusDiagnosticMonitoring?
  private var permissions: FocusDiagnosticPermissions?
  private var timer: Timer?
  private var records: [Data] = []
  private var bytes = 0
  private var sequence = 0
  private var dropped = 0
  private var encodingFailures = 0
  private var counts: [String: Int] = [:]
  private var lastTick = ProcessInfo.processInfo.systemUptime
  private var lastCheckpoint = 0.0
  private var exporting = false
  private var exportCheckpoint: Task<Void, Never>?
  private var lastBurst = 0.0

  func start() {
    guard Self.enabled, monitoring == nil else { return }
    monitoring = FocusDiagnosticMonitoring()
    monitoring?.start()
    record(
      "session.start", details: ["environment": FocusDiagnosticSnapshot.environment()], system: true
    )
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    self.timer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  @discardableResult
  func record(
    _ name: String, details: [String: JSONValue] = [:], system: Bool = false,
    correlation: Int? = nil
  ) -> Int {
    guard Self.enabled else { return 0 }
    sequence += 1
    counts[name, default: 0] += 1
    let started = ProcessInfo.processInfo.systemUptime
    let snapshot = FocusDiagnosticSnapshot.read(system: system)
    let value: JSONValue = .object([
      "session": .string(session), "sequence": .number(Double(sequence)),
      "wallTime": .string(Date.now.ISO8601Format()),
      "uptime": .number(started), "event": .string(name),
      "snapshotMs": .number((ProcessInfo.processInfo.systemUptime - started) * 1000),
      "correlation": correlation.map { .number(Double($0)) } ?? .null,
      "details": .object(details), "snapshot": snapshot,
    ])
    do {
      var data = try JSONEncoder().encode(value)
      data.append(0x0A)
      guard data.count <= FocusDiagnosticArchive.byteLimit else {
        dropped += 1
        return sequence
      }
      while !records.isEmpty
        && (records.count >= 3000 || bytes + data.count > FocusDiagnosticArchive.byteLimit)
      {
        bytes -= records.removeFirst().count
        dropped += 1
      }
      records.append(data)
      bytes += data.count
    } catch { encodingFailures += 1 }
    return sequence
  }

  func mouse(_ event: NSEvent, stage: String) {
    guard Self.enabled else { return }
    let correlation = record(
      stage,
      details: [
        "type": .number(Double(event.type.rawValue)), "timestamp": .number(event.timestamp),
        "eventNumber": .number(Double(event.eventNumber)),
        "windowNumber": .number(Double(event.windowNumber)),
        "button": .number(Double(event.buttonNumber)),
        "clickCount": .number(Double(event.clickCount)),
        "locationInWindow": .array([
          .number(event.locationInWindow.x), .number(event.locationInWindow.y),
        ]),
      ])
    if event.type == .leftMouseDown || event.type == .rightMouseDown
      || event.type == .otherMouseDown
    {
      burst(correlation: correlation)
    }
  }

  /// All activation follow-ups run; general mouse bursts are throttled to keep tracing bounded.
  func burst(correlation: Int, activation: Bool = false) {
    guard Self.enabled else { return }
    let now = ProcessInfo.processInfo.systemUptime
    guard activation || now - lastBurst > 0.2 else { return }
    lastBurst = now
    for delay in [0.0, 0.05, 0.25, 1.0] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.record(
          activation ? "activation.followup" : "mouse.followup",
          details: ["delay": .number(delay)], system: true, correlation: correlation)
      }
    }
  }

  private func tick() {
    let now = ProcessInfo.processInfo.systemUptime
    monitoring?.refreshPermission()
    permissions?.refresh(mouseTapActive: monitoring?.tapActive == true)
    record("sample", details: ["elapsed": .number(now - lastTick)], system: true)
    lastTick = now
    if now - lastCheckpoint >= 5 {
      lastCheckpoint = now
      let data = traceData()
      let sequence = sequence
      let archive = archive
      exportCheckpoint = Task { await archive.checkpoint(data, sequence: sequence) }
    }
  }

  private func traceData() -> Data {
    var data = Data(capacity: bytes)
    for record in records { data.append(record) }
    return data
  }

  func state() -> DiagnosticsStateResult {
    DiagnosticsStateResult(
      enabled: Self.enabled, accessibilityTrusted: AXIsProcessTrusted(),
      mouseTapActive: monitoring?.tapActive == true)
  }

  func preparePermissions(using trust: AccessibilityTrust, automatic: Bool = false) {
    guard Self.enabled else { return }
    if permissions == nil { permissions = FocusDiagnosticPermissions(trust: trust) }
    permissions?.request(automatic: automatic, mouseTapActive: monitoring?.tapActive == true)
  }

  func tapDisabled(reason: String) {
    monitoring?.tapDisabled(reason: reason)
  }

  func export(using panels: SystemPanels) async throws(BridgeError) -> Bool {
    guard Self.enabled else {
      throw BridgeError("Focus diagnostics are not enabled in this build.")
    }
    guard !exporting, !panels.isOpen else {
      throw BridgeError("Another export or file dialog is open.")
    }
    exporting = true
    defer { exporting = false }
    record("export.freeze", system: true)
    // Freeze before the save dialog changes activation, key window, level or mouse position.
    let trace = traceData()
    let frozenSequence = sequence
    let frozenDropped = dropped
    let frozenCounts = counts
    let frozenRetained = records.count
    let frozenEncodingFailures = encodingFailures
    let frozenCoverage = monitoring?.coverage ?? [:]
    let environment = FocusDiagnosticSnapshot.environment()
    await exportCheckpoint?.value
    await archive.checkpoint(trace, sequence: frozenSequence)
    let manifest: JSONValue = .object([
      "session": .string(session), "environment": environment,
      "lastSequence": .number(Double(frozenSequence)),
      "retainedRecords": .number(Double(frozenRetained)),
      "droppedRecords": .number(Double(frozenDropped)),
      "encodingFailures": .number(Double(frozenEncodingFailures)),
      "eventCounts": .object(frozenCounts.mapValues { .number(Double($0)) }),
      "coverage": .object(frozenCoverage),
      "checkpointFailed": .bool(await archive.writeFailed),
    ])
    guard
      let destination = await panels.chooseSaveLocation(
        suggestedName: "Atd-focus-\(session.prefix(8)).zip", contentType: .zip)
    else { return false }
    do {
      try await archive.export(
        current: trace, metadata: JSONEncoder().encode(manifest), to: destination)
      return true
    } catch {
      record("export.failed", details: ["code": .number(Double((error as NSError).code))])
      throw BridgeError(
        "The diagnostic report could not be saved. Choose a writable folder and try again.")
    }
  }
}
