import Foundation
import Testing

@testable import AICore

@Suite("Control stream frames")
struct ControlFrameTests {
  private static let requestJSON = """
    {"type":"capability.request","request":{"id":"req_1","revision":2,"capability":"file.save",
    "input":{"name":"a.txt","contentBase64":"aGk=","size":2,"flags":[true,null]},
    "taskId":"t1","runId":"r1","executionId":"e1","operationId":"o1",
    "expiresAt":"2026-09-29T10:00:00.000Z","createdAt":"2026-09-29T09:50:00.000Z"}}
    """

  @Test("Decodes the six frame types the shell acts on")
  func decodesKnownFrames() throws {
    #expect(
      decode(#"{"type":"status","running":2,"attention":1}"#)
        == .frame(.status(running: 2, attention: 1)))
    #expect(
      decode(#"{"type":"capability.registered","clientId":"c-1"}"#)
        == .frame(.capabilityRegistered(clientId: "c-1")))
    #expect(
      decode(#"{"type":"capability.ack","requestId":"r","ok":true}"#)
        == .frame(.capabilityAck(requestId: "r", ok: true, error: nil)))
    #expect(
      decode(#"{"type":"capability.ack","requestId":"r","ok":false,"error":"gone"}"#)
        == .frame(.capabilityAck(requestId: "r", ok: false, error: "gone")))
    #expect(decode(#"{"type":"pong"}"#) == .frame(.pong))
    #expect(
      decode(#"{"type":"error","error":"Unknown stream message."}"#)
        == .frame(.error("Unknown stream message.")))
  }

  @Test("Decodes a capability request with its untyped input")
  func decodesRequest() throws {
    guard case .frame(.capabilityRequest(let request)) = decode(Self.requestJSON) else {
      Issue.record("Expected a capability request.")
      return
    }
    #expect(request.id == "req_1")
    #expect(request.revision == 2)
    #expect(request.capability == .fileSave)
    #expect(
      request.input
        == .object([
          "name": .string("a.txt"), "contentBase64": .string("aGk="), "size": .number(2),
          "flags": .array([.bool(true), .null]),
        ]))
    #expect(request.expiresAt == "2026-09-29T10:00:00.000Z")
  }

  @Test("A request without input decodes with a null input")
  func requestWithoutInput() {
    let json = Self.requestJSON.replacingOccurrences(
      of: #""input":{"name":"a.txt","contentBase64":"aGk=","size":2,"flags":[true,null]},"#,
      with: "")
    guard case .frame(.capabilityRequest(let request)) = decode(json) else {
      Issue.record("Expected a capability request.")
      return
    }
    #expect(request.input == .null)
  }

  @Test(
    "Drops every other frame type",
    arguments: [
      (#"{"type":"summaries","epoch":1,"seq":2,"tasks":[]}"#, "summaries"),
      (#"{"type":"event","event":{"taskId":"t"}}"#, "event"),
      (#"{"type":"resumed","seq":3}"#, "resumed"),
      (#"{"type":"invalidate","domains":["settings"]}"#, "invalidate"),
      (#"{"type":"snapshot","snapshot":{}}"#, "snapshot"),
      (#"{"type":"capability.requested"}"#, "capability.requested"),
    ])
  func dropsOthers(text: String, type: String) {
    #expect(decode(text) == .ignored(type: type))
  }

  @Test(
    "Drops text that is not a typed JSON object",
    arguments: ["", "nope", "[]", "{}", #"{"type":1}"#])
  func dropsUntyped(text: String) {
    #expect(decode(text) == .ignored(type: nil))
  }

  @Test(
    "Reports known types in a shape the contract does not allow",
    arguments: [
      (#"{"type":"status","running":-1,"attention":0}"#, "status"),
      (#"{"type":"status","running":1}"#, "status"),
      (#"{"type":"status","running":1.5,"attention":0}"#, "status"),
      (#"{"type":"capability.registered"}"#, "capability.registered"),
      (#"{"type":"capability.ack","requestId":"r"}"#, "capability.ack"),
      (#"{"type":"error"}"#, "error"),
      (#"{"type":"capability.request","request":{"id":"x"}}"#, "capability.request"),
    ])
  func reportsMalformed(text: String, type: String) {
    #expect(decode(text) == .malformed(type: type))
  }

  @Test("An unknown capability is malformed, not guessed")
  func unknownCapability() {
    let json = Self.requestJSON.replacingOccurrences(of: "file.save", with: "screen.read")
    #expect(decode(json) == .malformed(type: "capability.request"))
  }

  @Test("Encodes the shell's outbound frames")
  func encodesOutbound() throws {
    #expect(
      ControlStream.subscribe()
        == #"{"epoch":0,"seq":0,"status":true,"taskIds":[],"type":"subscribe"}"#)
    #expect(ControlStream.ping() == #"{"type":"ping"}"#)
    #expect(
      ControlStream.register(DesktopCapability.allCases)
        == #"{"capabilities":["file.pick","file.save","selection.read","clipboard.read","clipboard.write"],"type":"capability.register"}"#
    )
    guard case .frame(.capabilityRequest(let request)) = decode(Self.requestJSON) else {
      Issue.record("Expected a capability request.")
      return
    }
    let success = CapabilityResult.success(
      request, value: .object(["saved": .bool(true), "size": .number(2)]))
    #expect(
      try ControlStream.result(success)
        == #"{"result":{"ok":true,"requestId":"req_1","revision":2,"value":{"saved":true,"size":2}},"type":"capability.result"}"#
    )
    let failure = CapabilityResult.failure(request, error: String(repeating: "x", count: 2500))
    #expect(failure.error?.count == CapabilityResult.maxErrorLength)
    #expect(try ControlStream.result(failure).contains(#""ok":false"#))
    let invalid = CapabilityResult.success(request, value: .number(.nan))
    #expect(throws: (any Error).self) { try ControlStream.result(invalid) }
  }

  @Test(
    "Reconnects on the page stream client's curve",
    arguments: [(-1, 250), (0, 250), (1, 500), (2, 1000), (4, 4000), (5, 5000), (60, 5000)])
  func reconnectDelay(failures: Int, milliseconds: Int) {
    #expect(ControlStream.reconnectDelay(failures: failures) == .milliseconds(milliseconds))
  }

  @Test("Pings well inside the service lease")
  func pingsInsideLease() {
    #expect(ControlStream.pingInterval * 2 < ControlStream.lease)
  }

  private func decode(_ text: String) -> ControlFrameDecoding { ControlFrameDecoder.decode(text) }
}
