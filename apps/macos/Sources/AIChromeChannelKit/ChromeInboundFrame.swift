import Foundation

/// A frame the extension sends the shell (K2, `CHROME_CHANNEL_PROTOCOL = 1`), mirrored by hand
/// from `apps/chrome-extension/src/channel/protocol.ts` and `payloads.ts`, the TypeBox source of
/// truth; change both together. Every frame is a `{v:1, t:'<type>', …}` object whose undeclared
/// members are ignored; a frame of a type this build does not know decodes as ``unknown(_:)``,
/// which the shell logs and ignores, while a known type with a malformed member is refused.
public enum ChromeInboundFrame: Decodable, Equatable, Sendable {
  case hello(ChromeHello)
  case pairRequest(code: String)
  case pairCancel
  case ask(ChromeAsk)
  case runStop(taskId: String, runId: String)
  /// Take over (`held`) or hand back: the run must not act in `tabId` while it is held.
  case runHold(
    taskId: String, runId: String, tabId: Int, held: Bool, ownInput: ChromeOwnInput? = nil)
  case requestAnswer(
    taskId: String, requestId: String, revision: Int, answer: ChromePermissionAnswer,
    ownInput: ChromeOwnInput? = nil)
  case runFollowUp(taskId: String, kind: ChromeFollowUpKind)
  case siteSet(origin: String, allowed: Bool)
  case appOpen(taskId: String?)
  case settingsOpen
  case tabState(ChromeTabState)
  case tabReleased(tabId: Int, reason: ChromeTabReleaseReason)
  case tabOpened(requestId: String, tabId: Int, targetId: String)
  /// `tab.open` could not open or own the tab; `reason` is a log line, never shown.
  case tabOpenFailed(requestId: String, reason: String)
  case tabHanded(runId: String, tabId: Int, targetId: String)
  /// The HUD's Dismiss on an ended run (v4): the shell may forget its `RunView`.
  case runDismiss(taskId: String, runId: String)
  /// CDP text for the worker connection `conn`: a response or an event of the emulated browser.
  /// The extension echoes the `conn` the shell sent (a string); a numeric one reads as its digits.
  case cdp(conn: String, msg: String)
  /// Bounded extension diagnostics batch (`diag.batch`), forwarded only while paired.
  case diagBatch(ChromeDiagBatch)
  case unknown(String)

  /// The frame's `t`, for logs.
  public var type: String {
    switch self {
    case .hello: "hello"
    case .pairRequest: "pair.request"
    case .pairCancel: "pair.cancel"
    case .ask: "ask"
    case .runStop: "run.stop"
    case .runHold: "run.hold"
    case .requestAnswer: "request.answer"
    case .runFollowUp: "run.followUp"
    case .siteSet: "site.set"
    case .appOpen: "app.open"
    case .settingsOpen: "settings.open"
    case .tabState: "tab.state"
    case .tabReleased: "tab.released"
    case .tabOpened: "tab.opened"
    case .tabOpenFailed: "tab.openFailed"
    case .tabHanded: "tab.handed"
    case .runDismiss: "run.dismiss"
    case .cdp: "cdp"
    case .diagBatch: "diag.batch"
    case .unknown(let type): type
    }
  }

  public init(from decoder: any Decoder) throws {
    typealias K = ChromeInboundKeys
    let head = try decoder.container(keyedBy: K.Head.self)
    try head.version(.v)
    let type = try head.text(.t, minLength: 1, maxLength: 64)
    func body<Keys: CodingKey>(_ keys: Keys.Type) throws
      -> KeyedDecodingContainer<Keys>
    {
      try ChromeChannelCoding.object(decoder, keys)
    }
    switch type {
    case "hello": self = .hello(try ChromeHello(body(K.Hello.self)))
    case "pair.request":
      self = .pairRequest(code: try body(K.Pair.self).text(.code, minLength: 4, maxLength: 4))
    case "pair.cancel":
      _ = try body(K.Empty.self)
      self = .pairCancel
    case "ask": self = .ask(try ChromeAsk(body(K.Ask.self)))
    case "run.stop":
      let c = try body(K.Run.self)
      self = .runStop(taskId: try c.id(.taskId), runId: try c.id(.runId))
    case "run.hold":
      let c = try body(K.Hold.self)
      self = .runHold(
        taskId: try c.id(.taskId), runId: try c.id(.runId), tabId: try c.whole(.tabId, minimum: 0),
        held: try c.decode(Bool.self, forKey: .held),
        ownInput: c.contains(.ownInput) ? try c.decode(ChromeOwnInput.self, forKey: .ownInput) : nil
      )
    case "request.answer":
      let c = try body(K.Answer.self)
      self = .requestAnswer(
        taskId: try c.id(.taskId), requestId: try c.id(.requestId),
        revision: try c.whole(.revision, minimum: 0),
        answer: try c.decode(ChromePermissionAnswer.self, forKey: .answer),
        ownInput: c.contains(.ownInput) ? try c.decode(ChromeOwnInput.self, forKey: .ownInput) : nil
      )
    case "run.followUp":
      let c = try body(K.FollowUp.self)
      self = .runFollowUp(
        taskId: try c.id(.taskId), kind: try c.decode(ChromeFollowUpKind.self, forKey: .kind))
    case "site.set":
      let c = try body(K.Site.self)
      self = .siteSet(
        origin: try c.text(.origin, minLength: 1, maxLength: ChromeChannelProtocol.maxOriginLength),
        allowed: try c.decode(Bool.self, forKey: .allowed))
    case "app.open":
      let c = try body(K.AppOpen.self)
      self = .appOpen(taskId: c.contains(.taskId) ? try c.id(.taskId) : nil)
    case "settings.open":
      _ = try body(K.Empty.self)
      self = .settingsOpen
    case "tab.state": self = .tabState(try ChromeTabState(body(K.TabState.self)))
    case "tab.released":
      let c = try body(K.Released.self)
      self = .tabReleased(
        tabId: try c.whole(.tabId, minimum: 0),
        reason: try c.decode(ChromeTabReleaseReason.self, forKey: .reason))
    case "tab.opened":
      let c = try body(K.Opened.self)
      self = .tabOpened(
        requestId: try c.id(.requestId), tabId: try c.whole(.tabId, minimum: 0),
        targetId: try c.targetId(.targetId))
    case "tab.openFailed":
      let c = try body(K.OpenFailed.self)
      self = .tabOpenFailed(
        requestId: try c.id(.requestId), reason: try c.text(.reason, maxLength: 500))
    case "tab.handed":
      let c = try body(K.Handed.self)
      self = .tabHanded(
        runId: try c.id(.runId), tabId: try c.whole(.tabId, minimum: 0),
        targetId: try c.targetId(.targetId))
    case "run.dismiss":
      let c = try body(K.Run.self)
      self = .runDismiss(taskId: try c.id(.taskId), runId: try c.id(.runId))
    case "cdp":
      let c = try body(K.Cdp.self)
      let conn: String
      if let text = try? c.text(.conn, minLength: 1, maxLength: 128) {
        conn = text
      } else {
        conn = String(try c.decode(Int.self, forKey: .conn))
      }
      self = .cdp(conn: conn, msg: try c.decode(String.self, forKey: .msg))
    case "diag.batch":
      self = .diagBatch(try ChromeDiagBatch(body(K.DiagBatch.self)))
    default:
      self = .unknown(type)
    }
  }
}

/// The members each inbound frame declares, `v` and `t` included; others are ignored.
public enum ChromeInboundKeys {
  public enum Head: String, CodingKey { case v, t }
  public enum Empty: String, CodingKey { case v, t }
  public enum Hello: String, CodingKey {
    case v, t, installationId, extensionVersion, flavor, chromeVersion, fileAccess, secret, profile
  }
  public enum Pair: String, CodingKey { case v, t, code }
  public enum Ask: String, CodingKey {
    case v, t, requestId, tabId, url, title, text, taskId, ownInput, elements
  }
  public enum Run: String, CodingKey { case v, t, taskId, runId }
  public enum Hold: String, CodingKey { case v, t, taskId, runId, tabId, held, ownInput }
  public enum Answer: String, CodingKey {
    case v, t, taskId, requestId, revision, answer, ownInput
  }
  public enum FollowUp: String, CodingKey { case v, t, taskId, kind }
  public enum Site: String, CodingKey { case v, t, origin, allowed }
  public enum AppOpen: String, CodingKey { case v, t, taskId }
  public enum TabState: String, CodingKey {
    case v, t, tabId, runId, targetId, url, title, active, focused, lastInputAt
  }
  public enum Released: String, CodingKey { case v, t, tabId, reason }
  public enum Opened: String, CodingKey { case v, t, requestId, tabId, targetId }
  public enum OpenFailed: String, CodingKey { case v, t, requestId, reason }
  public enum Handed: String, CodingKey { case v, t, runId, tabId, targetId }
  public enum Cdp: String, CodingKey { case v, t, conn, msg }
  public enum DiagBatch: String, CodingKey { case v, t, dropped, entries }
}
