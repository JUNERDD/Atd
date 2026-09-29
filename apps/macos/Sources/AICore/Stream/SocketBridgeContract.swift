import Foundation

/// The page ↔ shell messages of the virtual socket pipe. The page's stream transport (P3 bridge
/// contract, `StreamTransportFactory` in `@ai/agent-client`) is not merged yet, so every name and
/// shape the two sides must agree on lives here and nowhere else. Aligning with the final bridge
/// contract means editing this file only.
public enum SocketBridgeContract {
  /// Body of the `callAsyncJavaScript` that delivers a batch; ``batchArgument`` names the array
  /// of frame objects. The page handles the whole batch synchronously (spike S6).
  public static let deliveryFunctionBody = "window.__aiNativeBridge.socketFrames(frames);"
  public static let batchArgument = "frames"

  /// Keys of a page → shell command object and of a delivered frame.
  public static let operationKey = "op"
  public static let socketIdKey = "socketId"
  public static let textKey = "text"
  public static let codeKey = "code"
  public static let reasonKey = "reason"
  public static let kindKey = "kind"
  public static let dataKey = "data"

  /// Page-chosen socket ids: short and inert, since they are echoed back into the page.
  public static let maxSocketIdLength = 64
}

/// A page → shell command for one virtual socket, decoded from a script message body such as
/// `{ op: "send", socketId: "s1", text: "{\"type\":\"ping\"}" }`.
public enum VirtualSocketCommand: Equatable, Sendable {
  /// Open a stream connection to the service for `socketId`.
  case open(socketId: String)
  /// Send one text frame upstream; it passes ``UpstreamFrameFilter`` first.
  case send(socketId: String, text: String)
  /// The page closed the socket. `code` is nil when the page gave none or an invalid one.
  case close(socketId: String, code: UInt16?, reason: String)

  /// Decodes a script message body (an `NSDictionary` from WebKit). Anything else is nil: the
  /// page's own bridge never sends it, so the owner drops it.
  public init?(messageBody body: Any) {
    guard let object = body as? [String: Any],
      let operation = object[SocketBridgeContract.operationKey] as? String,
      let socketId = object[SocketBridgeContract.socketIdKey] as? String,
      Self.isValid(socketId: socketId)
    else { return nil }
    switch operation {
    case "open":
      self = .open(socketId: socketId)
    case "send":
      guard let text = object[SocketBridgeContract.textKey] as? String else { return nil }
      self = .send(socketId: socketId, text: text)
    case "close":
      let code = (object[SocketBridgeContract.codeKey] as? NSNumber).flatMap(Self.pageCloseCode)
      let reason = object[SocketBridgeContract.reasonKey] as? String ?? ""
      self = .close(socketId: socketId, code: code, reason: Self.closeReason(reason))
    default:
      return nil
    }
  }

  static func isValid(socketId: String) -> Bool {
    !socketId.isEmpty && socketId.utf8.count <= SocketBridgeContract.maxSocketIdLength
      && socketId.utf8.allSatisfy {
        (0x30...0x39).contains($0) || (0x41...0x5A).contains($0) || (0x61...0x7A).contains($0)
          || $0 == UInt8(ascii: "-") || $0 == UInt8(ascii: "_")
      }
  }

  /// A close reason is at most 123 UTF-8 bytes (RFC 6455); longer ones are cut at a character.
  static func closeReason(_ reason: String) -> String {
    var cut = reason
    while cut.utf8.count > 123 { cut.removeLast() }
    return cut
  }

  /// The codes a page may close with, as for the browser `WebSocket.close()`: 1000 or 3000–4999.
  private static func pageCloseCode(_ number: NSNumber) -> UInt16? {
    let value = number.intValue
    guard Double(value) == number.doubleValue, value == 1000 || (3000...4999).contains(value)
    else { return nil }
    return UInt16(value)
  }
}

/// A shell → page event for one virtual socket. Delivered as
/// `{ socketId, kind: "open" | "message" | "close", data }` where `data` is null, the frame's
/// text, or `{ code, reason }`.
public struct VirtualSocketFrame: Equatable, Sendable {
  public enum Kind: String, Sendable {
    case open
    case message
    case close
  }

  public let socketId: String
  public let kind: Kind
  /// The downstream text, unparsed (``Kind/message``).
  public let text: String?
  /// Close code and reason, forwarded unchanged (``Kind/close``).
  public let code: UInt16?
  public let reason: String?

  public static func open(_ socketId: String) -> VirtualSocketFrame {
    VirtualSocketFrame(socketId: socketId, kind: .open, text: nil, code: nil, reason: nil)
  }

  public static func message(_ socketId: String, text: String) -> VirtualSocketFrame {
    VirtualSocketFrame(socketId: socketId, kind: .message, text: text, code: nil, reason: nil)
  }

  public static func close(_ socketId: String, code: UInt16, reason: String) -> VirtualSocketFrame {
    VirtualSocketFrame(socketId: socketId, kind: .close, text: nil, code: code, reason: reason)
  }

  /// Approximate size on the bridge, for batch splitting.
  public var byteCost: Int {
    48 + socketId.utf8.count + (text?.utf8.count ?? 0) + (reason?.utf8.count ?? 0)
  }

  /// The object handed to `callAsyncJavaScript`, which converts it to a JS object.
  public func bridgeObject() -> [String: Any] {
    let data: Any
    switch kind {
    case .open: data = NSNull()
    case .message: data = text ?? ""
    case .close:
      data = [
        SocketBridgeContract.codeKey: Int(code ?? 1005),
        SocketBridgeContract.reasonKey: reason ?? "",
      ]
    }
    return [
      SocketBridgeContract.socketIdKey: socketId, SocketBridgeContract.kindKey: kind.rawValue,
      SocketBridgeContract.dataKey: data,
    ]
  }
}
