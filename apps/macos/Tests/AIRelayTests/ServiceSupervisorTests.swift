import AICore
import Darwin
import Foundation
import Testing

@testable import AIRelay

/// Supervises a fake bundled "node": a shell script that publishes an endpoint for its own pid
/// and, by default, clears it and exits on SIGTERM. Its port has no listener, so the shutdown
/// request fails at once and the supervisor falls back to SIGTERM. Everything lives in a
/// temporary directory.
@Suite("Service supervisor", .serialized)
@MainActor
struct ServiceSupervisorTests {
  private let root = FileManager.default.temporaryDirectory.appending(
    path: "supervisor-\(UUID().uuidString)", directoryHint: .isDirectory)

  private var data: URL { root.appending(path: "data", directoryHint: .isDirectory) }

  /// `onTerm` is the fake's SIGTERM trap, run with `dir` (the data directory) and `end` set.
  private func makeSupervisor(
    onTerm: String = #"rm -f "$dir/endpoint.json"; exit 0"#
  ) throws -> ServiceSupervisor {
    let resources = root.appending(path: "Resources", directoryHint: .isDirectory)
    let bin = resources.appending(path: "node/bin", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: resources.appending(path: "agent-service/dist"), withIntermediateDirectories: true)
    try Data(#"{"version":1,"buildId":"b1"}"#.utf8).write(
      to: resources.appending(path: "agent-service/build-info.json"))
    let port = try closedLoopbackPort()
    let token = String(repeating: "t", count: 43)
    let script = """
      #!/bin/sh
      dir="$4"
      mkdir -p "$dir/auth"
      echo "$@" > "$dir/../args.txt"
      printf '{"version":1,"serviceId":"fake","token":"\(token)","createdAt":"x"}' > "$dir/auth/token"
      printf '{"version":1,"serviceId":"fake","protocolVersion":"1","epoch":1,"host":"127.0.0.1","port":\(port),"url":"http://127.0.0.1:\(port)","pid":%s,"startedAt":"x","buildId":"b0"}' $$ > "$dir/endpoint.json.tmp"
      mv "$dir/endpoint.json.tmp" "$dir/endpoint.json"
      echo "fake service $$ up"
      trap '\(onTerm)' TERM
      # Never outlive a failed test by more than 30 s.
      end=$(( $(date +%s) + 30 ))
      while [ "$(date +%s)" -lt "$end" ]; do sleep 0.05; done
      """
    let node = bin.appending(path: "node")
    try Data(script.utf8).write(to: node)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
    return ServiceSupervisor(
      plan: ServiceLaunchPlan(resources: resources, dataDirectory: data),
      logDirectory: root.appending(path: "logs", directoryHint: .isDirectory))
  }

  /// A loopback port that was just free and has no listener: binding port 0, then closing.
  private func closedLoopbackPort() throws -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafeMutablePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(fd, $0, length) == 0 && getsockname(fd, $0, &length) == 0
      }
    }
    guard bound else { throw POSIXError(.EADDRNOTAVAIL) }
    return Int(UInt16(bigEndian: address.sin_port))
  }

  private func runningPid(_ supervisor: ServiceSupervisor) -> Int32? {
    if case .running(let endpoint) = supervisor.state { endpoint.pid } else { nil }
  }

  @Test("Spawns, restarts after a crash with backoff, trips the breaker, restarts and stops")
  func lifecycle() async throws {
    defer { try? FileManager.default.removeItem(at: root) }
    let supervisor = try makeSupervisor()
    defer { if let pid = runningPid(supervisor) { kill(pid, SIGKILL) } }
    let link = ServiceLink(source: supervisor)
    await supervisor.start()
    let first = try #require(runningPid(supervisor))
    #expect(
      try String(contentsOf: root.appending(path: "args.txt"), encoding: .utf8)
        .hasSuffix("serve --dataDir \(ServiceLaunchPlan.path(of: data)) --login-shell-path\n"))
    #expect(try await link.endpoint().get().pid == first)
    let log = try String(contentsOf: root.appending(path: "logs/service.log"), encoding: .utf8)
    #expect(log.contains("fake service \(first) up"))

    // Crash 1: restarted after the 500 ms backoff, with the previous log rotated.
    kill(first, SIGKILL)
    #expect(await Task.until(.seconds(5)) { supervisor.state == .restarting })
    #expect(await Task.until(.seconds(5)) { runningPid(supervisor).map { $0 != first } ?? false })
    let second = try #require(runningPid(supervisor))
    #expect(FileManager.default.fileExists(atPath: root.appending(path: "logs/service.1.log").path))

    // Crash 2 restarts again; crash 3 within five minutes opens the breaker.
    kill(second, SIGKILL)
    #expect(await Task.until(.seconds(5)) { runningPid(supervisor).map { $0 != second } ?? false })
    let third = try #require(runningPid(supervisor))
    kill(third, SIGKILL)
    #expect(await Task.until(.seconds(5)) { supervisor.state == .unavailable(.stoppedTooOften) })
    #expect(await link.endpoint() == .failure(.stoppedTooOften))

    // A manual restart forgets the history; quit stops the service with SIGTERM after the
    // shutdown request fails.
    await supervisor.restart()
    let fourth = try #require(runningPid(supervisor))
    await supervisor.stop()
    #expect(supervisor.state == .unavailable(.stopped))
    #expect(!isProcessAlive(fourth))
    #expect(!FileManager.default.fileExists(atPath: data.appending(path: "endpoint.json").path))
  }

  @Test("Kills a service whose process outlives its finished stop")
  func stuckExit() async throws {
    defer { try? FileManager.default.removeItem(at: root) }
    // What a libuv pool thread stuck in a blocking call does to Node: the stop finishes and
    // clears the endpoint, but the exit never completes and SIGTERM goes unanswered.
    let supervisor = try makeSupervisor(
      onTerm:
        #"rm -f "$dir/endpoint.json"; while [ "$(date +%s)" -lt "$end" ]; do sleep 0.05; done"#
    )
    await supervisor.start()
    let pid = try #require(runningPid(supervisor))
    defer { kill(pid, SIGKILL) }
    let started = ContinuousClock.now
    await supervisor.stop()
    #expect(!isProcessAlive(pid))
    // Killed after the exit grace that follows the cleared endpoint, not the graceful budget.
    #expect(ContinuousClock.now - started < ServiceStopper.gracefulStop / 2)
  }

  @Test("Shows a failed first start instead of retrying it")
  func failedStart() async throws {
    defer { try? FileManager.default.removeItem(at: root) }
    let supervisor = try makeSupervisor()
    let node = root.appending(path: "Resources/node/bin/node")
    try Data("#!/bin/sh\necho 'Error: cannot start' >&2\nexit 3\n".utf8).write(to: node)
    await supervisor.start()
    #expect(supervisor.state == .unavailable(.failed("Error: cannot start")))
  }
}
