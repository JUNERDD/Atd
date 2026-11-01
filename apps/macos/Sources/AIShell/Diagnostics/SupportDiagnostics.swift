import AICore
import AppKit
import ApplicationServices

/// Shared support-build lifecycle and export. A profile selects collectors at build time;
/// no user defaults or runtime switch can turn recording on in an ordinary build.
final class SupportDiagnostics {
  enum Profile: String { case none, runtime, focus }
  static let shared = SupportDiagnostics()
  static let profile =
    Profile(
      rawValue: Bundle.main.object(forInfoDictionaryKey: "AtdDiagnosticProfile") as? String ?? ""
    ) ?? .none
  static var enabled: Bool { profile != .none }

  private let recorder = DiagnosticRecorder()
  private let archive = SupportDiagnosticArchive(profile: profile.rawValue)
  private var timer: Timer?
  private var lastTick = ProcessInfo.processInfo.systemUptime
  private var lastCheckpoint = 0.0
  private var exporting = false
  private var checkpoint: Task<Void, Never>?

  func start() {
    guard Self.enabled, timer == nil else { return }
    SupportDiagnosticEvents.sink = { [weak self] name, details, correlation in
      self?.record(name, module: "relay", details: details, correlation: correlation) ?? 0
    }
    FocusDiagnostics.shared.start()
    record("session.start", details: ["environment": DiagnosticEnvironment.read()])
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    self.timer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  @discardableResult
  func record(
    _ name: String, module: String = "runtime", details: [String: JSONValue] = [:],
    snapshot: () -> JSONValue = { .null }, correlation: Int? = nil
  ) -> Int {
    guard Self.enabled else { return 0 }
    return recorder.record(
      name, module: module, details: details, snapshot: snapshot, correlation: correlation)
  }

  private func tick() {
    let now = ProcessInfo.processInfo.systemUptime
    record(
      "runtime.sample",
      details: [
        "elapsed": .number(now - lastTick), "appActive": .bool(NSApp.isActive),
        "visibleWindowCount": .number(Double(NSApp.windows.filter(\.isVisible).count)),
      ])
    FocusDiagnostics.shared.tick()
    lastTick = now
    if now - lastCheckpoint >= 5 {
      lastCheckpoint = now
      let trace = recorder.trace()
      let sequence = recorder.sequence
      checkpoint = Task { await archive.checkpoint(trace, sequence: sequence) }
    }
  }

  func state() -> DiagnosticsStateResult {
    DiagnosticsStateResult(
      enabled: Self.enabled, focusEnabled: FocusDiagnostics.enabled,
      accessibilityTrusted: AXIsProcessTrusted(), mouseTapActive: FocusDiagnostics.shared.tapActive)
  }

  func export(using panels: SystemPanels) async throws(BridgeError) -> Bool {
    guard Self.enabled else { throw BridgeError("Diagnostics are not enabled in this build.") }
    guard !exporting, !panels.isOpen else {
      throw BridgeError("Another export or file dialog is open.")
    }
    exporting = true
    defer { exporting = false }
    FocusDiagnostics.shared.record("focus.export.freeze", system: true)
    record("export.freeze")
    // Freeze before a save dialog changes the state under investigation.
    let trace = recorder.trace()
    let sequence = recorder.sequence
    var manifest = recorder.manifest()
    manifest["environment"] = DiagnosticEnvironment.read()
    manifest["profile"] = .string(Self.profile.rawValue)
    manifest["collectors"] = .array(
      (["runtime", "bridge", "relay", "renderer"] + (FocusDiagnostics.enabled ? ["focus"] : []))
        .map(JSONValue.string))
    manifest["coverage"] = .object(FocusDiagnostics.shared.coverage)
    manifest["limitations"] = .array([
      .string("Service internals, model requests and plugin internals are not collected."),
      .string("Renderer evidence requires the page to load and its bridge to be ready."),
    ])
    await checkpoint?.value
    await archive.checkpoint(trace, sequence: sequence)
    manifest["checkpointFailed"] = .bool(await archive.writeFailed)
    guard
      let destination = await panels.chooseSaveLocation(
        suggestedName: "Atd-diagnostics-\(recorder.session.prefix(8)).zip", contentType: .zip)
    else { return false }
    do {
      try await archive.export(
        current: trace, metadata: JSONEncoder().encode(JSONValue.object(manifest)),
        notes: FocusDiagnostics.enabled ? FocusDiagnostics.reportNotes : "", to: destination)
      return true
    } catch {
      record("export.failed", details: ["code": .number(Double((error as NSError).code))])
      throw BridgeError(
        "The diagnostic report could not be saved. Choose a writable folder and try again.")
    }
  }
}
