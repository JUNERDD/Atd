import Foundation

/// WebSocket close codes the shell sends to the page's virtual sockets.
public enum WebSocketCloseCode {
  /// RFC 6455 Policy Violation: the page sent a frame outside the upstream allow-list.
  public static let policyViolation: UInt16 = 1008
  /// RFC 6455 Service Restart: the service restarted or its endpoint changed; the page's
  /// stream client reconnects with its own backoff and resubscribes.
  public static let serviceRestart: UInt16 = 1012

  /// The code a page's close takes upstream. The contract allows 1000–4999; a browser
  /// `WebSocket.close()` only 1000 and 3000–4999, so anything else closes normally.
  public static func upstream(pageCode code: Int) -> UInt16 {
    code == 1000 || (3000...4999).contains(code) ? UInt16(code) : 1000
  }

  /// A close reason is at most 123 UTF-8 bytes (RFC 6455); longer ones are cut at a character.
  /// The contract counts 123 characters, which can be more bytes.
  public static func reason(_ reason: String) -> String {
    var cut = reason
    while cut.utf8.count > 123 { cut.removeLast() }
    return cut
  }
}

/// A frame the page sends on a virtual socket.
public enum UpstreamFrame: Sendable {
  case text(String)
  case binary(Data)
}

/// The upstream frame types a page may send; everything else is the shell's alone
/// (`capability.register`, `capability.result`) or unknown.
public enum UpstreamFrameType: String, CaseIterable, Sendable {
  case subscribe
  case ping
}

public enum UpstreamVerdict: Equatable, Sendable {
  /// Forward the original frame, byte for byte.
  case forward(UpstreamFrameType)
  /// Close the virtual socket with this code and reason; nothing is forwarded.
  case close(code: UInt16, reason: String)
}

/// Default-deny filter for page → service stream frames. It reads nothing but `type`, and
/// only when the frame has exactly one top-level `type` key holding a string.
public enum UpstreamFrameFilter {
  /// Far above any legitimate frame (a subscribe names at most 100 ids of 128 characters).
  public static let maxFrameBytes = 64 * 1024

  public static func check(_ frame: UpstreamFrame) -> UpstreamVerdict {
    guard case .text(let text) = frame else { return deny("Binary frames are not accepted.") }
    let bytes = Array(text.utf8)
    guard bytes.count <= maxFrameBytes else { return deny("The frame is too large.") }
    guard (try? JSONSerialization.jsonObject(with: Data(bytes))) is [String: Any],
      let members = JSONMembers.scan(bytes)
    else { return deny("The frame is not a JSON object.") }
    let types = members.filter { $0.key.utf8.elementsEqual("type".utf8) }
    guard types.count == 1, let raw = types.first?.value,
      let value = JSONMembers.decodeString(raw)
    else { return deny("The frame needs exactly one string type.") }
    guard
      let type = UpstreamFrameType.allCases.first(where: {
        $0.rawValue.utf8.elementsEqual(value.utf8)
      })
    else { return deny("This frame type is not accepted.") }
    return .forward(type)
  }

  private static func deny(_ reason: String) -> UpstreamVerdict {
    .close(code: WebSocketCloseCode.policyViolation, reason: reason)
  }
}
