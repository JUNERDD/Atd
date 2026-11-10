import AICore
import AppKit
import Testing

@testable import AIShell

/// Real recording orchestration without a loaded renderer, running service, screen capture,
/// microphone, model request or global shortcut registration. Only the import test's loopback
/// stub has an endpoint; all files and settings belong to this fixture.
@MainActor
final class RecordingPreparationFixture {
  let root: URL
  let controller: ScreenRecordingController
  let host: WebViewHost
  let progress: CommandProgressController
  let stub: RecordingImportStub
  private let defaultsName: String

  private init(root: URL, stub: RecordingImportStub, port: Int) throws {
    _ = NSApplication.shared
    self.root = root
    self.stub = stub
    defaultsName = "recording-preparation-test.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: defaultsName))
    let data = root.appending(path: "data")
    try Self.endpoint(in: data, port: port, token: stub.token)
    let services = ShellServices.development(
      environment: ["AI_AGENT_DATA_DIR": data.path], home: root)
    let host = WebViewHost(role: .panel, fragment: nil, services: services, bridge: ShellBridge())
    self.host = host
    let arbiter = DeviceArbiter()
    let panels = SystemPanels(lowerPanel: {}, restorePanel: {}, arbiter: arbiter)
    let attachments = AttachmentImporter(services: services, panel: host, systemPanels: panels)
    let toolbar = SelectionToolbarController(
      trust: AccessibilityTrust(defaults: defaults), services: services)
    let progress = CommandProgressController(
      host, toolbar: toolbar, returnFocus: { _ in },
      attachments: ComposeAttachments(
        screenshot: { fatalError("The preparation fixture cannot capture the screen") },
        pickFiles: { fatalError("The preparation fixture cannot open a file picker") },
        openScreenRecordingSettings: {}),
      answerWriter: { _, _ in fatalError("The preparation fixture cannot write to other apps") },
      arbiter: arbiter)
    self.progress = progress
    let controller = ScreenRecordingController(
      island: progress.recording, arbiter: arbiter, attachments: attachments, panelHost: host,
      screenAccess: ScreenRecordingTrust(), defaults: defaults, showPanel: {})
    self.controller = controller
    host.onDocumentUnload = { [weak controller] in controller?.pageDidUnload() }
  }

  static func make() async throws -> RecordingPreparationFixture {
    let root = URL.temporaryDirectory.appending(path: "recording-preparation-\(UUID().uuidString)")
    let stub = try RecordingImportStub()
    let port = try await stub.start()
    do {
      return try RecordingPreparationFixture(root: root, stub: stub, port: port)
    } catch {
      stub.stop()
      try? FileManager.default.removeItem(at: root)
      throw error
    }
  }

  func folder(_ label: String) -> URL {
    root.appending(path: "\(label)-\(UUID().uuidString)")
  }

  func install(_ result: RecordingResult) -> CaptureLifecycleWeak<RecordingKept> {
    let kept = RecordingKept(
      result, source: RecordingCardSource(result, id: UUID().uuidString, saveFolder: "Fixture"))
    controller.kept = kept
    return CaptureLifecycleWeak(kept)
  }

  func ask() throws -> (id: String, task: Task<Void, Never>) {
    let kept = try #require(controller.kept)
    let id = UUID().uuidString
    controller.send(
      RecordingAsk(
        id: id, question: "Describe the synthetic fixture",
        range: RecordingTrim(start: 0, end: kept.result.duration)))
    return (id, try #require(controller.preparingAsks[id]))
  }

  /// A real JPEG proves decoding and encoding began; the absent context proves preparation
  /// has not finished. The measured cancellation therefore exercises active work.
  func activeExport(in folder: URL) async throws -> URL {
    let deadline = ContinuousClock.now + .seconds(15)
    while ContinuousClock.now < deadline {
      for export in try contents(of: folder) where export.lastPathComponent.hasPrefix("export-") {
        let files = try contents(of: export)
        if files.contains(where: { $0.pathExtension == "jpg" }),
          !files.contains(where: { $0.pathExtension == "md" })
        {
          return export
        }
      }
      // Waiting until a complete export would measure an HTTP wait, not media cancellation.
      guard stub.requests == 0 else { throw ObservationError.preparationAlreadyFinished }
      try await Task.sleep(for: .milliseconds(1))
    }
    throw ObservationError.noActiveExport
  }

  func waitForImport() async throws {
    let deadline = ContinuousClock.now + .seconds(15)
    while stub.paths.isEmpty, ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(2))
    }
    _ = try #require(!stub.paths.isEmpty)
  }

  func contents(of folder: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
  }

  func exists(_ file: URL) -> Bool { FileManager.default.fileExists(atPath: file.path) }

  func dispose() {
    controller.cancelForQuit()
    progress.island.hide()
    host.close()
    stub.stop()
    UserDefaults.standard.removePersistentDomain(forName: defaultsName)
    try? FileManager.default.removeItem(at: root)
  }

  private static func endpoint(in data: URL, port: Int, token: String) throws {
    try FileManager.default.createDirectory(
      at: data.appending(path: "auth"), withIntermediateDirectories: true)
    let endpoint: [String: Any] = [
      "version": 1, "serviceId": "recording-test", "protocolVersion": "1", "epoch": 1,
      "host": "127.0.0.1", "port": port, "url": "http://127.0.0.1:\(port)",
      "pid": Int(getpid()), "startedAt": "2026-11-09T00:00:00Z",
    ]
    let credentials: [String: Any] = [
      "version": 1, "serviceId": "recording-test", "token": token,
      "createdAt": "2026-11-09T00:00:00Z",
    ]
    try JSONSerialization.data(withJSONObject: endpoint).write(
      to: data.appending(path: "endpoint.json"), options: .atomic)
    try JSONSerialization.data(withJSONObject: credentials).write(
      to: data.appending(path: "auth/token"), options: .atomic)
  }

  private enum ObservationError: Error {
    case preparationAlreadyFinished
    case noActiveExport
  }
}
