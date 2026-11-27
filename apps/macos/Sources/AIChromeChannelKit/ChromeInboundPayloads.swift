import Foundation

// The payloads of the frames the extension sends, mirrored by hand from
// `apps/chrome-extension/src/channel/protocol.ts` and `payloads.ts` (TypeBox, the source of truth
// for K2). Each decodes the members its schema declares and ignores any other;
// ``ChromeInboundFrame`` picks it by `t`.

/// `hello`: the extension's first frame on a connection.
public struct ChromeHello: Equatable, Sendable {
  public enum Flavor: String, Codable, Sendable {
    case release
    case dev
  }

  public struct Profile: Decodable, Equatable, Sendable {
    public let label: String
    public let email: String?

    public init(label: String, email: String?) {
      self.label = label
      self.email = email
    }

    public init(from decoder: any Decoder) throws {
      let container = try ChromeChannelCoding.object(decoder, CodingKeys.self)
      label = try container.text(.label, maxLength: 200)
      email = try container.optionalText(.email, maxLength: ChromeChannelProtocol.maxTextLength)
    }

    private enum CodingKeys: String, CodingKey { case label, email }
  }

  /// The extension's installation id. `IdSchema` admits any string, the shell only an
  /// `Identifier` (the extension mints a UUID): it becomes the site bindings' `profileId`.
  public let installationId: String
  public let extensionVersion: String
  public let flavor: Flavor
  public let chromeVersion: String
  /// Whether the person allowed the extension access to file URLs (`upload` needs it).
  public let fileAccess: Bool
  /// The pairing secret the shell issued, absent before pairing.
  public let secret: String?
  public let profile: Profile

  init(_ container: KeyedDecodingContainer<ChromeInboundKeys.Hello>) throws {
    installationId = try container.identifier(.installationId)
    extensionVersion = try container.text(.extensionVersion, maxLength: 32)
    flavor = try container.decode(Flavor.self, forKey: .flavor)
    chromeVersion = try container.text(.chromeVersion, maxLength: 64)
    fileAccess = try container.decode(Bool.self, forKey: .fileAccess)
    secret = try container.optionalText(.secret, maxLength: 256)
    profile = try container.decode(Profile.self, forKey: .profile)
  }
}

/// `ownInput`: hardware input timestamps (ms since 1970) recorded on Atd's in-page HUD layer.
public struct ChromeOwnInput: Decodable, Equatable, Sendable {
  public let keyDown: Double?
  public let leftMouseDown: Double?
  public let rightMouseDown: Double?
  public let otherMouseDown: Double?
  public let scrollWheel: Double?

  public init(
    keyDown: Double? = nil, leftMouseDown: Double? = nil, rightMouseDown: Double? = nil,
    otherMouseDown: Double? = nil, scrollWheel: Double? = nil
  ) {
    self.keyDown = keyDown
    self.leftMouseDown = leftMouseDown
    self.rightMouseDown = rightMouseDown
    self.otherMouseDown = otherMouseDown
    self.scrollWheel = scrollWheel
  }

  public init(from decoder: any Decoder) throws {
    let container = try ChromeChannelCoding.object(decoder, Keys.self)
    keyDown = try container.optionalNonNegativeFinite(.keyDown)
    leftMouseDown = try container.optionalNonNegativeFinite(.leftMouseDown)
    rightMouseDown = try container.optionalNonNegativeFinite(.rightMouseDown)
    otherMouseDown = try container.optionalNonNegativeFinite(.otherMouseDown)
    scrollWheel = try container.optionalNonNegativeFinite(.scrollWheel)
  }

  private enum Keys: String, CodingKey {
    case keyDown, leftMouseDown, rightMouseDown, otherMouseDown, scrollWheel
  }
}

/// `PickedElementSchema`: an element the person picked on the page with the in-page inspector.
/// Page content the person chose, not an instruction: the shell only quotes it to the model.
public struct ChromePickedElement: Decodable, Equatable, Sendable {
  /// A CSS selector that matched only this element in the top document when it was picked.
  public let selector: String
  /// What it is, for a person: its role or tag and its accessible name, e.g. `button "Sign up"`.
  public let label: String
  /// Its visible text, whitespace collapsed to single spaces, clipped; empty when none.
  public let text: String

  public init(selector: String, label: String, text: String) {
    self.selector = selector
    self.label = label
    self.text = text
  }

  public init(from decoder: any Decoder) throws {
    let container = try ChromeChannelCoding.object(decoder, Keys.self)
    selector = try container.text(.selector, minLength: 1, maxLength: 1_000)
    label = try container.text(.label, minLength: 1, maxLength: 300)
    text = try container.text(.text, maxLength: 1_000)
  }

  private enum Keys: String, CodingKey { case selector, label, text }
}

/// `ask`: the person's request from the in-page ask or the panel. `url` and `title` are empty
/// when the person removed the page from the request.
public struct ChromeAsk: Equatable, Sendable {
  public let requestId: String
  public let tabId: Int
  public let url: String
  public let title: String
  public let text: String
  /// The conversation the request continues: a task this profile started from Chrome, whose run
  /// it follows up; nil starts a new task.
  public let taskId: String?
  public let ownInput: ChromeOwnInput?
  /// The 1 to 5 elements the person picked on the page, in order. The extension sends them only
  /// with the page (a non-empty `url`); the shell does not rely on it.
  public let elements: [ChromePickedElement]?

  init(_ container: KeyedDecodingContainer<ChromeInboundKeys.Ask>) throws {
    requestId = try container.id(.requestId)
    tabId = try container.whole(.tabId, minimum: 0)
    url = try container.text(.url, maxLength: ChromeChannelProtocol.maxTextLength)
    title = try container.text(.title, maxLength: ChromeChannelProtocol.maxTextLength)
    text = try container.text(.text, maxLength: ChromeChannelProtocol.maxTextLength)
    taskId = container.contains(.taskId) ? try container.id(.taskId) : nil
    ownInput =
      container.contains(.ownInput)
      ? try container.decode(ChromeOwnInput.self, forKey: .ownInput) : nil
    elements = try container.optionalArray(
      .elements, of: ChromePickedElement.self, minCount: 1, maxCount: 5)
  }
}

/// `request.answer`'s `answer`: the `PermissionAnswer` shape of `POST /v1/confirms`.
public enum ChromePermissionAnswer: Decodable, Equatable, Sendable {
  case once
  case session
  case declined
  case text(String)
  case skipped

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    if container.contains(.decision) {
      switch try container.decode(String.self, forKey: .decision) {
      case "once": self = .once
      case "session": self = .session
      case "declined": self = .declined
      case let other:
        throw DecodingError.dataCorruptedError(
          forKey: .decision, in: container, debugDescription: "Unknown decision \(other).")
      }
    } else if container.contains(.answer) {
      self = .text(try container.text(.answer, minLength: 1, maxLength: 10_000))
    } else if container.contains(.skipped), try container.decode(Bool.self, forKey: .skipped) {
      self = .skipped
    } else {
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Not a permission answer."))
    }
  }

  private enum Keys: String, CodingKey { case decision, answer, skipped }
}

/// `tab.state`: an owned tab as the extension sees it now.
public struct ChromeTabState: Equatable, Sendable {
  public let tabId: Int
  /// The run that owns the tab (v4), also for a tab the shell never handed: one the run opened
  /// (`Target.createTarget`), a popup or a tab opened from an owned tab.
  public let runId: String?
  /// The tab's CDP target id once the debugger knows it.
  public let targetId: String?
  public let url: String
  public let title: String
  /// The selected tab of its window.
  public let active: Bool
  /// Its window is Chrome's focused window.
  public let focused: Bool
  /// When the person last pressed a key, clicked or scrolled in the tab (ms since 1970).
  public let lastInputAt: Double?

  public init(
    tabId: Int, runId: String? = nil, targetId: String?, url: String, title: String,
    active: Bool, focused: Bool, lastInputAt: Double?
  ) {
    self.tabId = tabId
    self.runId = runId
    self.targetId = targetId
    self.url = url
    self.title = title
    self.active = active
    self.focused = focused
    self.lastInputAt = lastInputAt
  }

  init(_ container: KeyedDecodingContainer<ChromeInboundKeys.TabState>) throws {
    tabId = try container.whole(.tabId, minimum: 0)
    runId = container.contains(.runId) ? try container.id(.runId) : nil
    targetId = try container.optionalText(
      .targetId, minLength: 1, maxLength: ChromeChannelProtocol.maxTargetIdLength)
    url = try container.text(.url, maxLength: ChromeChannelProtocol.maxTextLength)
    title = try container.text(.title, maxLength: ChromeChannelProtocol.maxTextLength)
    active = try container.decode(Bool.self, forKey: .active)
    focused = try container.decode(Bool.self, forKey: .focused)
    lastInputAt = try container.decodeIfPresent(Double.self, forKey: .lastInputAt)
  }
}

/// Why an owned tab left a run (`tab.released`).
public enum ChromeTabReleaseReason: String, Codable, Sendable {
  case closed
  case ungrouped
  /// Chrome's "started debugging this browser" infobar Cancel: the person stopped the run.
  case canceledByUser
  case detached
}

/// The `kind` of a `run.followUp`.
public enum ChromeFollowUpKind: String, Codable, Sendable {
  case saveAutomation
}
