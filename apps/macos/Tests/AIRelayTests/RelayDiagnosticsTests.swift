import AICore
import Darwin
import Foundation
import Testing
import WebKit

@testable import AIRelay

@Suite("Relay diagnostics codes, cross-path adoption guard, and ShellClient snapshot", .serialized)
@MainActor
struct RelayDiagnosticsTests {
  @Test("APIRelay maps ServiceUnavailable to 503 structured error codes and scrubbed summaries")
  func apiRelayStructuredUnavailableErrors() async throws {
    let stub = try StubService()
    let port = try await stub.start()
    let harness = try RelayHarness(stub: stub, port: port)
    await harness.load()
    defer { harness.tearDown() }

    let customSource = MutableUnavailableSource(
      reason: .failed("Error: failed opening /Users/" + "alicecorp" + "/Library/service.lock"),
      lastFailure: "Error: crashed on /Users/" + "alicecorp" + "/Library/service.lock")
    let customLink = ServiceLink(source: customSource)
    let customHandler = RendererSchemeHandler(
      renderer: .bundle(harness.root.appending(path: "renderer")), link: customLink)

    func fetchUnavailable() async throws -> (status: Int, code: String, message: String) {
      var req = URLRequest(url: URL(string: "ai-app://renderer/v1/echo")!)
      req.httpMethod = "GET"
      req.mainDocumentURL = URL(string: "ai-app://renderer/")
      let task = RecordingSchemeTask(req)
      customHandler.webView(harness.webView, start: task)
      _ = await Task.until { task.ended }
      let status = task.response?.statusCode ?? 0
      let parsed = (try? JSONSerialization.jsonObject(with: task.body)) as? [String: Any]
      let err = parsed?["error"] as? [String: Any]
      return (status, err?["code"] as? String ?? "", err?["message"] as? String ?? "")
    }

    let failedAns = try await fetchUnavailable()
    #expect(failedAns.status == 503)
    #expect(failedAns.code == "service_start_failed")
    #expect(!failedAns.message.contains("alicecorp"))

    customSource.reason = .stoppedTooOften
    let breakerAns = try await fetchUnavailable()
    #expect(breakerAns.status == 503)
    #expect(breakerAns.code == "service_stopped_too_often")
    #expect(!breakerAns.message.contains("alicecorp"))
    #expect(breakerAns.message.contains("Error: crashed on"))

    customSource.reason = .starting
    #expect(try await fetchUnavailable().code == "service_starting")

    customSource.reason = .invalidEndpoint(.tokenMismatch)
    let invalidAns = try await fetchUnavailable()
    #expect(invalidAns.code == "service_not_running")
    #expect(invalidAns.message == "Service endpoint unusable (token_mismatch).")
  }

  @Test(
    "ServiceSupervisor retains lastFailureSummary into .stoppedTooOften and clears on manual restart"
  )
  func supervisorRetainsAndClearsFailureSummary() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: "sup-diag-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    let resources = root.appending(path: "Resources", directoryHint: .isDirectory)
    let bin = resources.appending(path: "node/bin", directoryHint: .isDirectory)
    let data = root.appending(path: "data", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: resources.appending(path: "agent-service/dist"), withIntermediateDirectories: true)
    try Data(#"{"version":1,"buildId":"b1"}"#.utf8).write(
      to: resources.appending(path: "agent-service/build-info.json"))

    let token = String(repeating: "t", count: 43)
    let userLeak = "/Users/" + "alicecorp" + "/secret"
    // Publishes endpoint then crashes with non-zero code after 80ms; once `healthy` marker exists,
    // stays alive until SIGTERM.
    let script = """
      #!/bin/sh
      dir="$4"
      mkdir -p "$dir/auth"
      printf '{"version":1,"serviceId":"fake","token":"\(token)","createdAt":"x"}' > "$dir/auth/token"
      printf '{"version":1,"serviceId":"fake","protocolVersion":"1","epoch":1,"host":"127.0.0.1","port":59999,"url":"http://127.0.0.1:59999","pid":%s,"startedAt":"x","buildId":"b0"}' $$ > "$dir/endpoint.json.tmp"
      mv "$dir/endpoint.json.tmp" "$dir/endpoint.json"
      if [ ! -f "$dir/healthy" ]; then
        echo "Error: crash in \(userLeak)" >&2
        sleep 0.08
        exit 2
      fi
      trap 'rm -f "$dir/endpoint.json"; exit 0' TERM
      end=$(( $(date +%s) + 20 ))
      while [ "$(date +%s)" -lt "$end" ]; do sleep 0.05; done
      """
    let node = bin.appending(path: "node")
    try Data(script.utf8).write(to: node)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)

    let supervisor = ServiceSupervisor(
      plan: ServiceLaunchPlan(resources: resources, dataDirectory: data),
      logDirectory: root.appending(path: "logs", directoryHint: .isDirectory))

    await supervisor.start()
    #expect(await Task.until(.seconds(8)) { supervisor.state == .unavailable(.stoppedTooOften) })
    let retained = try #require(supervisor.lastFailureSummary)
    #expect(!retained.contains("alicecorp"))
    #expect(retained.contains("Error: crash in"))
    #expect(!supervisor.recentExits.isEmpty)

    // Manual restart into `.running` clears `lastFailureSummary`.
    try Data("ok".utf8).write(to: data.appending(path: "healthy"))
    await supervisor.restart()
    #expect(
      await Task.until(.seconds(5)) {
        if case .running = supervisor.state { return true }
        return false
      })
    #expect(supervisor.lastFailureSummary == nil)
    await supervisor.stop()
  }

  @Test(
    "ServiceSupervisor blocks DMG/Translocation cross-path adoption and adopts symlink-matching bundle"
  )
  func crossPathAdoptionBlockedAndSameBundleAdopted() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: "sup-adopt-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    let stub = try StubService()
    let port = try await stub.start()
    defer { stub.stop() }

    // Spawn a real background sleeper whose pid represents a running service process.
    let foreignChild = Process()
    foreignChild.executableURL = URL(filePath: "/bin/sleep")
    foreignChild.arguments = ["30"]
    try foreignChild.run()
    let childPid = foreignChild.processIdentifier
    defer { if foreignChild.isRunning { kill(childPid, SIGKILL) } }

    let realAppBundle = root.appending(path: "RealApps/Atd.app", directoryHint: .isDirectory)
    let resources = realAppBundle.appending(path: "Contents/Resources", directoryHint: .isDirectory)
    let bin = resources.appending(path: "node/bin", directoryHint: .isDirectory)
    let data = root.appending(path: "data", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: resources.appending(path: "agent-service/dist"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: data.appending(path: "auth"), withIntermediateDirectories: true)
    try Data(#"{"version":1,"buildId":"same-build-1"}"#.utf8).write(
      to: resources.appending(path: "agent-service/build-info.json"))

    let symlinkAppBundle = root.appending(path: "SymlinkAtd.app")
    try FileManager.default.createSymbolicLink(
      at: symlinkAppBundle, withDestinationURL: realAppBundle)

    func writeRunningEndpoint(pid: Int32, port targetPort: Int) throws {
      let ep: [String: Any] = [
        "version": 1, "serviceId": "stub-service", "protocolVersion": "1", "epoch": stub.epoch,
        "host": "127.0.0.1", "port": targetPort, "url": "http://127.0.0.1:\(targetPort)",
        "pid": Int(pid), "startedAt": "2026-11-18T00:00:00Z", "buildId": "same-build-1",
      ]
      let tok: [String: Any] = [
        "version": 1, "serviceId": "stub-service", "token": stub.token,
        "createdAt": "2026-11-18T00:00:00Z",
      ]
      try JSONSerialization.data(withJSONObject: ep).write(
        to: data.appending(path: "endpoint.json"))
      try JSONSerialization.data(withJSONObject: tok).write(to: data.appending(path: "auth/token"))
    }

    // 1) Symlinked bundle path vs real executable path inside `RealApps/Atd.app`: ADOPTED!
    try writeRunningEndpoint(pid: childPid, port: port)
    let ring = RelayAndSupervisorRing(capacity: 16)
    let sameBundleSupervisor = ServiceSupervisor(
      plan: ServiceLaunchPlan(resources: resources, dataDirectory: data),
      logDirectory: root.appending(path: "logs1"),
      bundleURL: symlinkAppBundle,
      decisionRing: ring,
      executablePathProvider: { _ in
        realAppBundle.appending(path: "Contents/Resources/node/bin/node").path(
          percentEncoded: false)
      })
    await sameBundleSupervisor.start()
    #expect(
      sameBundleSupervisor.state == .running(try ServiceDiscovery.read(dataDirectory: data).get()))
    #expect(ring.snapshot().entries.last?.detail.stringValue == "adopted_running_service")

    // 2) Foreign DMG `/Volumes/Atd/Atd.app` executable path with identical `buildId`: REJECTED!
    stub.stop()
    try writeRunningEndpoint(pid: childPid, port: port)
    let nodeScript = """
      #!/bin/sh
      echo "Error: local spawn ran after rejecting DMG node" >&2
      exit 4
      """
    let localNode = bin.appending(path: "node")
    try Data(nodeScript.utf8).write(to: localNode)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: localNode.path)

    let dmgRing = RelayAndSupervisorRing(capacity: 16)
    let dmgRejectSupervisor = ServiceSupervisor(
      plan: ServiceLaunchPlan(resources: resources, dataDirectory: data),
      logDirectory: root.appending(path: "logs2"),
      bundleURL: realAppBundle,
      decisionRing: dmgRing,
      executablePathProvider: { _ in "/Volumes/Atd/Atd.app/Contents/Resources/node/bin/node" })
    await dmgRejectSupervisor.start()
    #expect(
      dmgRing.snapshot().entries.contains {
        $0.detail.stringValue == "rejected_foreign_bundle_service"
      })
    #expect(
      dmgRejectSupervisor.state
        == .unavailable(.failed("Error: local spawn ran after rejecting DMG node")))
  }

  @Test(
    "ShellClient.diagnosticsSnapshot enforces <= 600KiB bound while APIRelay blocks renderer access"
  )
  func shellClientSnapshotAndRendererIsolation() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }

    // Renderer requesting SHELL_ROUTE `/v1/admin/diagnostics/snapshot` must be denied 403!
    let deniedStatus =
      try await h.js(
        "return (await fetch('/v1/admin/diagnostics/snapshot')).status") as? Int
    #expect(deniedStatus == 403)

    // `ShellClient` fetches valid JSON with Bearer token and rejects responses exceeding `maxBytes`.
    let endpoint = try #require(try? await h.link.endpoint().get())
    let client = ShellClient(endpoint: endpoint)
    let snapshotData = try await client.diagnosticsSnapshot()
    let snapshotObj = try #require(
      JSONSerialization.jsonObject(with: snapshotData) as? [String: Any])
    #expect(snapshotObj["target"] as? String == "/v1/admin/diagnostics/snapshot")
    #expect(h.stub.hits.last?.headers["authorization"] == "Bearer \(h.stub.token)")

    await #expect(throws: ShellClientError.invalidResponse) {
      _ = try await client.diagnosticsSnapshot(maxBytes: 10)
    }
    await #expect(throws: ShellClientError.self) {
      _ = try await client.diagnosticsSnapshot(maxBytes: 0)
    }
  }
}

@MainActor
private final class MutableUnavailableSource: ServiceEndpointSource {
  var reason: ServiceUnavailable
  var lastFailureSummary: String?
  var endpointMayHaveChanged: (@MainActor () -> Void)?

  init(reason: ServiceUnavailable, lastFailure: String?) {
    self.reason = reason
    self.lastFailureSummary = lastFailure
  }

  func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    .failure(reason)
  }
}
