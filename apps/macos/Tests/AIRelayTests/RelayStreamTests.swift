import AICore
import Foundation
import Testing
import WebKit

@testable import AIRelay

/// Virtual sockets and the control stream end to end against ``StubService``.
@Suite("Relay stream integration")
@MainActor
struct RelayStreamTests {
  private static let subscribeAndPing = """
    socket({ op: 'open', socketId: 's1' });
    await waitFor(() => framesOf('s1').some((f) => f.kind === 'open'));
    socket({ op: 'send', socketId: 's1', text: '{"type":"subscribe","epoch":0,"seq":0}' });
    socket({ op: 'send', socketId: 's1', text: '{"type":"ping"}' });
    await waitFor(() => framesOf('s1').length >= 3);
    return framesOf('s1').map((f) => f.kind + ':' + (typeof f.data === 'string' ? f.data : ''));
    """

  private static let forbiddenFrame = """
    socket({ op: 'send', socketId: 's1', text: '{"type":"capability.result","result":{}}' });
    const close = await waitFor(() => framesOf('s1').find((f) => f.kind === 'close'));
    return [close.data.code, close.data.reason];
    """

  private static let serviceClose = """
    socket({ op: 'open', socketId: 's2' });
    await waitFor(() => framesOf('s2').length);
    socket({ op: 'send', socketId: 's2',
      text: '{"type":"subscribe","epoch":0,"seq":0,"taskIds":["close-me"]}' });
    const close = await waitFor(() => framesOf('s2').find((f) => f.kind === 'close'));
    return [close.data.code, close.data.reason];
    """

  private static let openS3 = """
    socket({ op: 'open', socketId: 's3' });
    await waitFor(() => framesOf('s3').length);
    return [];
    """

  private static let restarted = """
    const close = await waitFor(() => framesOf('s3').find((f) => f.kind === 'close'));
    return [close.data.code, window.__frames.filter((f) => f.kind === 'close').length];
    """

  @Test("Pipes virtual sockets transparently and closes them by the rules")
  func pipesSockets() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }

    let opened = try await h.values(Self.subscribeAndPing).compactMap { $0 as? String }
    #expect(
      opened == [
        "open:", #"message:{"type":"echo","frame":{"type":"subscribe","epoch":0,"seq":0}}"#,
        #"message:{"type":"pong"}"#,
      ])

    let policy = try await h.values(Self.forbiddenFrame)
    #expect(policy.first as? Int == 1008)
    #expect(policy.last as? String == "This frame type is not accepted.")
    #expect(!h.stub.frames.contains { $0.contains("capability.result") })

    let forwarded = try await h.values(Self.serviceClose)
    #expect(forwarded.first as? Int == 4001)
    #expect(forwarded.last as? String == "bye")

    // A restart (a new epoch in endpoint.json) closes sockets of the old instance with 1012.
    _ = try await h.values(Self.openS3)
    let port = try #require(h.link.latest.flatMap { try? $0.get() }?.baseURL.port)
    try h.writeEndpoint(port: port, epoch: 9)
    _ = await h.link.endpoint()
    #expect(try await h.values(Self.restarted).compactMap { $0 as? Int } == [1012, 3])

    // A new document closes the old one's sockets without delivering anything.
    _ = try await h.values(Self.openS3.replacingOccurrences(of: "s3", with: "s4"))
    #expect(h.pipe.socketCount == 1)
    h.pipe.resetForNewDocument()
    #expect(h.pipe.socketCount == 0)
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
