import AICore
import Foundation
import Testing
import WebKit

@testable import AIRelay

/// Virtual sockets and the control stream end to end against ``StubService``.
@Suite("Relay stream integration")
@MainActor
struct RelayStreamTests {
  @Test("Pipes virtual sockets transparently and closes them by the rules")
  func pipesSockets() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    let open = { (id: String) in h.pipe.open(.init(socketId: id)) }
    let send = { (id: String, data: String) in h.pipe.send(.init(socketId: id, data: data)) }

    open("s1")
    #expect(await Task.until { h.frames(of: "s1") == ["open"] })
    send("s1", #"{"type":"subscribe","epoch":0,"seq":0}"#)
    send("s1", #"{"type":"ping"}"#)
    #expect(await Task.until { h.frames(of: "s1").count >= 3 })
    #expect(
      h.frames(of: "s1") == [
        "open", #"message:{"type":"echo","frame":{"type":"subscribe","epoch":0,"seq":0}}"#,
        #"message:{"type":"pong"}"#,
      ])

    send("s1", #"{"type":"capability.result","result":{}}"#)
    #expect(h.frames(of: "s1").last == "close:1008:This frame type is not accepted.")
    #expect(!h.stub.frames.contains { $0.contains("capability.result") })

    open("s2")
    #expect(await Task.until { h.frames(of: "s2") == ["open"] })
    send("s2", #"{"type":"subscribe","epoch":0,"seq":0,"taskIds":["close-me"]}"#)
    #expect(await Task.until { h.frames(of: "s2").last == "close:4001:bye" })

    // A restart (a new epoch in endpoint.json) closes sockets of the old instance with 1012.
    open("s3")
    #expect(await Task.until { h.frames(of: "s3") == ["open"] })
    let port = try #require(h.link.latest.flatMap { try? $0.get() }?.baseURL.port)
    try h.writeEndpoint(port: port, epoch: 9)
    _ = await h.link.endpoint()
    #expect(h.frames(of: "s3").last?.hasPrefix("close:1012:") == true)

    // A page close sends nothing back; a new document closes the rest without delivering.
    open("s4")
    open("s5")
    #expect(await Task.until { h.frames(of: "s5") == ["open"] })
    h.pipe.close(.init(socketId: "s4", code: 1000, reason: ""))
    #expect(h.pipe.socketCount == 1)
    let delivered = h.frames.count
    h.pipe.resetForNewDocument()
    #expect(h.pipe.socketCount == 0)
    #expect(h.frames.count == delivered)
  }

  @Test("Runs the control stream: subscribe, register, status, capability round trip")
  func controlStream() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    let capabilities = RecordingCapabilities()
    let control = ControlStreamClient(link: h.link, capabilities: capabilities)
    var states: [ControlStreamClient.ConnectionState] = []
    control.onConnectionState = { states.append($0) }
    control.start()
    defer { control.stop() }

    #expect(await Task.until { control.status == .init(running: 2, attention: 1) })
    #expect(states.first == .connecting)
    #expect(control.state == .connected)
    let subscribe = #"{"epoch":0,"seq":0,"status":true,"taskIds":[],"type":"subscribe"}"#
    #expect(h.stub.frames.first == subscribe)
    let register = h.stub.frames.dropFirst().first ?? ""
    #expect(register.contains(#""type":"capability.register""#))
    #expect(
      register.contains(
        #"["file.pick","file.save","selection.read","clipboard.read","clipboard.write"]"#))

    h.stub.broadcast(
      """
      {"type":"capability.request","request":{"id":"req-1","revision":1,
      "capability":"clipboard.read","taskId":"t","runId":"r","executionId":"e","operationId":"o",
      "expiresAt":"2026-09-29T10:10:00.000Z","createdAt":"2026-09-29T10:00:00.000Z"}}
      """)
    #expect(await Task.until { h.stub.frames.contains { $0.contains("capability.result") } })
    #expect(capabilities.requests.map(\.id) == ["req-1"])
    let result = h.stub.frames.first { $0.contains("capability.result") } ?? ""
    #expect(result.contains(#""requestId":"req-1","revision":1"#))
    #expect(result.contains(#""ok":true"#))
    #expect(result.contains(#""value":{"text":"clipboard text"}"#))

    // The service goes away: the stream reports it and keeps retrying.
    try FileManager.default.removeItem(at: h.dataDirectory.appending(path: "endpoint.json"))
    h.stub.stop()
    #expect(await Task.until { control.state == .disconnected })
    #expect(control.unavailable == .developmentServiceNotRunning)
  }
}
