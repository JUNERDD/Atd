import Foundation
import Testing

@testable import AICore

@Suite("Service endpoint discovery")
struct ServiceEndpointTests {
  private static let directory = URL(fileURLWithPath: "/tmp/AgentService Test", isDirectory: true)
  private static let token = String(repeating: "t", count: 43)

  private static func endpoint(_ overrides: [String: Any] = [:], removing: [String] = []) -> Data {
    var object: [String: Any] = [
      "version": 1, "serviceId": "svc-1", "protocolVersion": "1", "epoch": 7, "host": "127.0.0.1",
      "port": 51234, "url": "http://127.0.0.1:51234", "pid": 4242,
      "startedAt": "2026-09-29T10:00:00.000Z",
    ]
    object.merge(overrides) { _, new in new }
    for key in removing { object[key] = nil }
    return try! JSONSerialization.data(withJSONObject: object)
  }

  private static func tokenFile(_ overrides: [String: Any] = [:]) -> Data {
    var object: [String: Any] = [
      "version": 1, "serviceId": "svc-1", "token": token, "createdAt": "2026-09-29T09:00:00.000Z",
    ]
    object.merge(overrides) { _, new in new }
    return try! JSONSerialization.data(withJSONObject: object)
  }

  private func parse(_ endpoint: Data, _ token: Data = tokenFile()) throws(ServiceEndpointError)
    -> ServiceEndpoint
  {
    try ServiceEndpointFiles.parse(endpoint: endpoint, token: token, dataDirectory: Self.directory)
  }

  @Test("Pairs a valid endpoint with its token")
  func valid() throws {
    let endpoint = try parse(Self.endpoint(["buildId": "b-9"]))
    #expect(endpoint.baseURL.absoluteString == "http://127.0.0.1:51234")
    #expect(endpoint.streamURL.absoluteString == "ws://127.0.0.1:51234/v1/stream")
    #expect(endpoint.token == Self.token)
    #expect(endpoint.epoch == 7)
    #expect(endpoint.pid == 4242)
    #expect(endpoint.buildId == "b-9")
    #expect(try parse(Self.endpoint(["url": "http://127.0.0.1:51234/"])).buildId == nil)
  }

  @Test("Takes localhost and IPv6 loopback")
  func loopbackHosts() throws {
    #expect(
      try parse(Self.endpoint(["url": "http://localhost:9"])).baseURL.absoluteString
        == "http://localhost:9")
    #expect(
      try parse(Self.endpoint(["url": "http://[::1]:9"])).streamURL.absoluteString
        == "ws://[::1]:9/v1/stream")
  }

  @Test(
    "Refuses endpoints that are not plain loopback http",
    arguments: [
      "http://127.0.0.1.example.com:1", "https://127.0.0.1:1", "http://10.0.0.2:1",
      "http://127.0.0.1", "http://127.0.0.1:1/v1", "http://u:p@127.0.0.1:1", "http://127.0.0.1:1?x",
      "ws://127.0.0.1:1",
      "not a url",
    ])
  func notLoopback(url: String) {
    #expect(throws: ServiceEndpointError.notLoopback) { try parse(Self.endpoint(["url": url])) }
  }

  @Test("Refuses another protocol version, a foreign token and malformed files")
  func refusals() {
    #expect(throws: ServiceEndpointError.unsupportedProtocol) {
      try parse(Self.endpoint(["protocolVersion": "2"]))
    }
    #expect(throws: ServiceEndpointError.tokenMismatch) {
      try parse(Self.endpoint(), Self.tokenFile(["serviceId": "svc-2"]))
    }
    #expect(throws: ServiceEndpointError.malformed("auth/token")) {
      try parse(Self.endpoint(), Self.tokenFile(["token": "short"]))
    }
    #expect(throws: ServiceEndpointError.malformed("auth/token")) {
      try parse(Self.endpoint(), Self.tokenFile(["extra": true]))
    }
    #expect(throws: ServiceEndpointError.malformed("auth/token")) {
      try parse(Self.endpoint(), Data("{".utf8))
    }
    let malformed: [Data] = [
      Self.endpoint(["version": 2]), Self.endpoint(["epoch": -1]), Self.endpoint(["port": 0]),
      Self.endpoint(["pid": 0]), Self.endpoint(["serviceId": ""]), Self.endpoint(["buildId": ""]),
      Self.endpoint(["unexpected": 1]), Self.endpoint(removing: ["pid"]), Data("[]".utf8),
    ]
    for data in malformed {
      #expect(throws: ServiceEndpointError.malformed("endpoint.json")) { try parse(data) }
    }
  }

  @Test("Identifies one instance by service, epoch, pid and address")
  func sameInstance() throws {
    let first = try parse(Self.endpoint())
    #expect(first.isSameInstance(as: try parse(Self.endpoint())))
    #expect(!first.isSameInstance(as: try parse(Self.endpoint(["epoch": 8]))))
    #expect(!first.isSameInstance(as: try parse(Self.endpoint(["pid": 4243]))))
    #expect(
      !first.isSameInstance(as: try parse(Self.endpoint(["url": "http://127.0.0.1:51235"]))))
  }

  @Test("Resolves the data directory: trimmed override first, then the per-mode default")
  func dataDirectory() {
    let home = URL(fileURLWithPath: "/Users/dev", isDirectory: true)
    #expect(
      ServiceDataDirectory.resolve(environment: [:], home: home, development: true).path
        == "/Users/dev/Library/Application Support/AgentService Dev")
    #expect(
      ServiceDataDirectory.resolve(environment: [:], home: home, development: false).path
        == "/Users/dev/Library/Application Support/AgentService")
    #expect(
      ServiceDataDirectory.resolve(
        environment: ["AI_AGENT_DATA_DIR": "  /tmp/x/../iso  "], home: home, development: false
      ).path == "/tmp/iso")
    #expect(
      ServiceDataDirectory.resolve(
        environment: ["AI_AGENT_DATA_DIR": "   "], home: home, development: true
      ).lastPathComponent == "AgentService Dev")
  }
}
