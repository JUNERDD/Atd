import Foundation

// The payloads of the frames the shell sends the extension, mirrored by hand from
// `apps/chrome-extension/src/channel/protocol.ts` and `payloads.ts` (TypeBox, the source of truth
// for K2). The extension checks every frame against its schema and drops one that fails, so the
// initializers clip strings and arrays to the schema's limits.

/// `prefs`: what the extension follows from Atd (D13).
public struct ChromePrefs: Encodable, Equatable, Sendable {
  public enum Language: String, Encodable, Sendable {
    case english = "en"
    case simplifiedChinese = "zh-CN"
  }

  /// The service's `language`.
  public let language: Language
  /// The workspace's glow effects setting.
  public let glowEffects: Bool

  public init(language: Language, glowEffects: Bool) {
    self.language = language
    self.glowEffects = glowEffects
  }
}

/// `welcome`'s `hostState`: whether this shell can run tasks for the extension now.
public enum ChromeHostState: String, Encodable, Sendable {
  case ready
  /// Another Atd holds the computer host lock.
  case otherHost
  case serviceUnavailable
}

/// `welcome`: the shell's answer to `hello`, sent again whenever any member changes.
public struct ChromeWelcome: Encodable, Equatable, Sendable {
  public let paired: Bool
  public let installationId: String
  public let label: String?
  public let browser: String?
  public let appVersion: String
  public let prefs: ChromePrefs
  public let sites: [String]
  public let hostState: ChromeHostState

  public init(
    paired: Bool, installationId: String, label: String?, browser: String? = nil,
    appVersion: String, prefs: ChromePrefs, sites: [String], hostState: ChromeHostState
  ) {
    self.paired = paired
    self.installationId = installationId
    self.label = label?.clipped(toUTF16: 200)
    self.browser = browser.flatMap {
      let trimmed = $0.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed.clipped(toUTF16: 120)
    }
    self.appVersion = appVersion.clipped(toUTF16: 64)
    self.prefs = prefs
    self.sites = Array(sites.prefix(1000))
    self.hostState = hostState
  }
}

/// `pair.state`: where a pairing request stands; `secret` only with `paired`.
public struct ChromePairState: Encodable, Equatable, Sendable {
  public enum State: String, Encodable, Sendable {
    case pending
    case paired
    case denied
    case error
  }

  public let state: State
  public let code: String?
  public let secret: String?
  public let label: String?
  public let reason: String?

  public init(
    state: State, code: String? = nil, secret: String? = nil, label: String? = nil,
    reason: String? = nil
  ) {
    self.state = state
    self.code = code?.clipped(toUTF16: 16)
    self.secret = secret
    self.label = label?.clipped(toUTF16: 200)
    self.reason = reason?.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
  }
}

/// One pending request of a run, as the HUD answers it (D10).
public enum ChromeHudRequest: Encodable, Equatable, Sendable {
  case confirmation(
    requestId: String, revision: Int, title: String, detail: String, effect: String?)
  case input(requestId: String, revision: Int, title: String, options: [String])

  public var requestId: String {
    switch self {
    case .confirmation(let requestId, _, _, _, _), .input(let requestId, _, _, _): requestId
    }
  }

  public var revision: Int {
    switch self {
    case .confirmation(_, let revision, _, _, _), .input(_, let revision, _, _): revision
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .confirmation(let requestId, let revision, let title, let detail, let effect):
      try container.encode("confirmation", forKey: .kind)
      try container.encode(requestId, forKey: .requestId)
      try container.encode(revision, forKey: .revision)
      try container.encode(
        title.clipped(toUTF16: ChromeChannelProtocol.maxTextLength), forKey: .title)
      try container.encode(
        detail.clipped(toUTF16: ChromeChannelProtocol.maxTextLength), forKey: .detail)
      try container.encodeIfPresent(effect?.clipped(toUTF16: 32), forKey: .effect)
    case .input(let requestId, let revision, let title, let options):
      try container.encode("input", forKey: .kind)
      try container.encode(requestId, forKey: .requestId)
      try container.encode(revision, forKey: .revision)
      try container.encode(
        title.clipped(toUTF16: ChromeChannelProtocol.maxTextLength), forKey: .title)
      try container.encode(options.prefix(8).map { $0.clipped(toUTF16: 500) }, forKey: .options)
    }
  }

  private enum Keys: String, CodingKey {
    case kind, requestId, revision, title, detail, effect, options
  }
}

/// One run tied to this Chrome, as the HUD, the tab group and the badge show it.
public struct ChromeRunView: Encodable, Equatable, Sendable {
  public enum Status: String, Encodable, Sendable {
    case working
    case attention
    case held
    case stopping
    case stopped
    case done
    case failed
    case disconnected
  }

  /// A run's reply: its answer once it is done, or, while it runs, the message it is writing or
  /// wrote last (`state`), which its next message replaces.
  public struct Result: Encodable, Equatable, Sendable {
    public enum State: String, Encodable, Sendable {
      /// The run is writing this message, and has started nothing else since.
      case writing
      /// The run went on to another step after writing it.
      case paused
    }

    public let text: String
    public let clipped: Bool
    /// Absent once the run is done: the text is its answer.
    public let state: State?

    public init(text: String, clipped: Bool, state: State? = nil) {
      let fitted = text.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
      self.text = fitted
      self.clipped = clipped || fitted != text
      self.state = state
    }
  }

  public struct Problem: Encodable, Equatable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
      self.code = code.clipped(toUTF16: 128)
      self.message = message.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
    }
  }

  public let taskId: String
  public let runId: String
  public let title: String
  /// What the person sent from this Chrome to start the run, for runs the extension started: a
  /// follow-up's own words, which the task's title (its first request) does not show.
  public let prompt: String?
  public let status: Status
  public let step: String?
  public let tabs: [Int]
  public let focusTabId: Int?
  public let requests: [ChromeHudRequest]
  public let result: Result?
  public let problem: Problem?
  public let fromExtension: Bool

  public init(
    taskId: String, runId: String, title: String, prompt: String? = nil, status: Status,
    step: String?, tabs: [Int], focusTabId: Int?, requests: [ChromeHudRequest], result: Result?,
    problem: Problem?, fromExtension: Bool
  ) {
    self.taskId = taskId
    self.runId = runId
    self.title = title.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
    self.prompt = prompt?.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
    self.status = status
    self.step = step?.clipped(toUTF16: ChromeChannelProtocol.maxTextLength)
    self.tabs = Array(tabs.prefix(64))
    self.focusTabId = focusTabId
    self.requests = Array(requests.prefix(16))
    self.result = result
    self.problem = problem
    self.fromExtension = fromExtension
  }
}

/// `pointer`: computer progress geometry in CSS px of the page `pageId` (the tab's CDP target
/// id); `phase: 'cleared'` hides it.
public struct ChromePointer: Encodable, Equatable, Sendable {
  public struct Rect: Encodable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
      self.x = x
      self.y = y
      self.width = width
      self.height = height
    }
  }

  public struct Size: Encodable, Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
      self.width = width
      self.height = height
    }
  }

  public let pageId: String
  public let phase: String
  public let label: String
  public let rect: Rect?
  public let viewport: Size?

  public init(pageId: String, phase: String, label: String, rect: Rect?, viewport: Size?) {
    self.pageId = pageId
    self.phase = phase
    self.label = label.clipped(toUTF16: 64)
    self.rect = rect
    self.viewport = viewport
  }
}
