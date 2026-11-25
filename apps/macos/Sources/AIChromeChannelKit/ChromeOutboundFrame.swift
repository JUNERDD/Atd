import Foundation

/// A frame the shell sends the extension (K2), mirrored by hand from
/// `apps/chrome-extension/src/channel/protocol.ts` and `payloads.ts`; change both together. Each encodes as a
/// `{v:1, t:'<type>', …}` object; ``serialized()`` is the JSON one message carries, which
/// ``ChromeChannelFraming/chunks(of:id:)`` splits when it is too large for Chrome.
public enum ChromeOutboundFrame: Encodable, Equatable, Sendable {
  case welcome(ChromeWelcome)
  case pairState(ChromePairState)
  case unpaired
  case prefs(ChromePrefs)
  case sites(origins: [String])
  case runs([ChromeRunView])
  case pointer(ChromePointer)
  /// Own `tabId` for run `runId`: group it, and attach the debugger when the run uses it.
  case tabHand(runId: String, tabId: Int)
  /// Open `url` in a background tab of the `Atd` group for `runId`; answered by `tab.opened`.
  case tabOpen(requestId: String, runId: String, url: String)
  case cdpOpen(conn: String)
  case cdpClose(conn: String)
  /// CDP text the worker sent on connection `conn`.
  case cdp(conn: String, msg: String)
  case askAccepted(requestId: String, taskId: String, runId: String)
  case askFailed(requestId: String, reason: String)
  case error(ref: String?, code: String, message: String)

  public var type: String {
    switch self {
    case .welcome: "welcome"
    case .pairState: "pair.state"
    case .unpaired: "unpaired"
    case .prefs: "prefs"
    case .sites: "sites"
    case .runs: "runs"
    case .pointer: "pointer"
    case .tabHand: "tab.hand"
    case .tabOpen: "tab.open"
    case .cdpOpen: "cdp.open"
    case .cdpClose: "cdp.close"
    case .cdp: "cdp"
    case .askAccepted: "ask.accepted"
    case .askFailed: "ask.failed"
    case .error: "error"
    }
  }

  /// The frame's JSON.
  public func serialized() throws -> Data { try ChromeChannelCoding.encode(self) }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    try c.encode(ChromeChannelProtocol.version, forKey: .v)
    try c.encode(type, forKey: .t)
    switch self {
    case .welcome(let welcome): try welcome.encode(to: encoder)
    case .pairState(let state): try state.encode(to: encoder)
    case .unpaired: break
    case .prefs(let prefs): try prefs.encode(to: encoder)
    case .sites(let origins): try c.encode(Array(origins.prefix(1000)), forKey: .origins)
    case .runs(let runs): try c.encode(Array(runs.prefix(8)), forKey: .runs)
    case .pointer(let pointer): try pointer.encode(to: encoder)
    case .tabHand(let runId, let tabId):
      try c.encode(runId, forKey: .runId)
      try c.encode(tabId, forKey: .tabId)
    case .tabOpen(let requestId, let runId, let url):
      try c.encode(requestId, forKey: .requestId)
      try c.encode(runId, forKey: .runId)
      try c.encode(url, forKey: .url)
    case .cdpOpen(let conn), .cdpClose(let conn): try c.encode(conn, forKey: .conn)
    case .cdp(let conn, let msg):
      try c.encode(conn, forKey: .conn)
      try c.encode(msg, forKey: .msg)
    case .askAccepted(let requestId, let taskId, let runId):
      try c.encode(requestId, forKey: .requestId)
      try c.encode(taskId, forKey: .taskId)
      try c.encode(runId, forKey: .runId)
    case .askFailed(let requestId, let reason):
      try c.encode(requestId, forKey: .requestId)
      try c.encode(reason.clipped(toUTF16: ChromeChannelProtocol.maxTextLength), forKey: .reason)
    case .error(let ref, let code, let message):
      try c.encodeIfPresent(ref?.clipped(toUTF16: 256), forKey: .ref)
      try c.encode(code.clipped(toUTF16: 128), forKey: .code)
      try c.encode(message.clipped(toUTF16: ChromeChannelProtocol.maxTextLength), forKey: .message)
    }
  }

  private enum Keys: String, CodingKey {
    case v, t, origins, runs, runId, tabId, requestId, url, conn, msg, taskId, reason, ref, code
    case message
  }
}

/// Canonical `error` frame codes the shell sends the extension, mirrored by hand in
/// `apps/chrome-extension/src/channel/protocol.ts`.
public enum ChromeChannelErrorCode {
  public static let browserNotVerified = "browserNotVerified"
  public static let browserMismatch = "browserMismatch"
  public static let originMismatch = "originMismatch"
  public static let pairingsUnavailable = "pairingsUnavailable"
  public static let notPaired = "notPaired"
  public static let malformed = "malformed"
}
