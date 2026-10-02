import Foundation
import Testing

@testable import AICore

/// Regression coverage for the page → Swift boundary. The page is the less trusted side, so the
/// generated `JsMessage` decoding must enforce the contract's constraints itself (closed objects,
/// literals, lengths, patterns, ranges, item counts). These cases came from the
/// swift-openapi-generator evaluation, which accepted seven of the invalid ones.
@Suite("Bridge decoding")
struct BridgeDecodingTests {
  private static func decode(_ json: String) throws -> JsMessage {
    try JSONDecoder().decode(JsMessage.self, from: Data(json.utf8))
  }

  private static func rects(_ count: Int) -> String {
    (0..<count).map { _ in #"{"x":0,"y":0,"width":1,"height":1}"# }.joined(separator: ",")
  }

  /// A link of exactly `length` characters, the contract's limit being 8192.
  private static func link(length: Int) -> String {
    "https://" + String(repeating: "a", count: length - "https://".count)
  }

  @Test(
    "Refuses messages outside the contract",
    arguments: [
      (
        "extra params member",
        #"{"type":"call","id":1,"method":"link.open","params":{"url":"https://a.b","x":1}}"#
      ),
      (
        "extra envelope member",
        #"{"type":"call","id":1,"method":"window.show","params":{},"x":1}"#
      ),
      (
        "non-http link",
        #"{"type":"call","id":1,"method":"link.open","params":{"url":"file:///etc/passwd"}}"#
      ),
      (
        "link over 8192 characters",
        #"{"type":"call","id":1,"method":"link.open","params":{"url":""#
          + link(length: 8193) + #""}}"#
      ),
      (
        "more than 64 drag regions",
        #"{"type":"post","method":"window.dragRegions","params":{"rects":["#
          + rects(65) + "]}}"
      ),
      (
        "post carrying a call id",
        #"{"type":"post","id":1,"method":"link.open","params":{"url":"https://a.b"}}"#
      ),
      ("unknown method", #"{"type":"call","id":1,"method":"nope","params":{}}"#),
      ("call id below 1", #"{"type":"call","id":0,"method":"window.show","params":{}}"#),
      (
        "empty socket id",
        #"{"type":"post","method":"socket.send","params":{"socketId":"","data":"x"}}"#
      ),
      (
        "save content outside its variants",
        #"{"type":"call","id":1,"method":"files.save","params":{"name":"a","#
          + #""content":{"type":"pdf","text":"x"}}}"#
      ),
      (
        "missing required nullable member",
        #"{"type":"call","id":1,"method":"settings.open","params":{}}"#
      ),
      (
        "language outside the literals",
        #"{"type":"post","method":"language.set","params":{"language":"fr"}}"#
      ),
      ("unknown envelope type", #"{"type":"event","event":"window.active","payload":{}}"#),
    ])
  func refuses(_ name: String, _ json: String) {
    #expect(throws: (any Error).self, "\(name)") { try Self.decode(json) }
  }

  @Test("Decodes a call with its typed params and id")
  func decodesCall() throws {
    let message = try Self.decode(
      #"{"type":"call","id":7,"method":"link.open","params":{"url":"https://a.b"}}"#)
    #expect(message == .call(id: 7, .linkOpen(LinkOpenParams(url: "https://a.b"))))
  }

  @Test("Accepts values exactly at the contract's limits")
  func acceptsLimits() throws {
    let link = try Self.decode(
      #"{"type":"call","id":1,"method":"link.open","params":{"url":""#
        + Self.link(length: 8192) + #""}}"#)
    guard case .call(_, .linkOpen(let params)) = link else {
      Issue.record("expected link.open, got \(link)")
      return
    }
    #expect(params.url.count == 8192)

    let regions = try Self.decode(
      #"{"type":"post","method":"window.dragRegions","params":{"rects":["# + Self.rects(64)
        + "]}}")
    guard case .post(.windowDragRegions(let post)) = regions else {
      Issue.record("expected window.dragRegions, got \(regions)")
      return
    }
    #expect(post.rects.count == 64)
  }

  @Test("Accepts null for a required nullable member")
  func acceptsNull() throws {
    let message = try Self.decode(
      #"{"type":"call","id":1,"method":"settings.open","params":{"commandId":null}}"#)
    guard case .call(_, .settingsOpen) = message else {
      Issue.record("expected settings.open, got \(message)")
      return
    }
  }
}
