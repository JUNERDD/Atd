import Foundation

/// What an admitted selection brings up first, whatever the activation (`toolbar.set`'s
/// `smallIcon`): the whole toolbar, or a small icon by the pointer that grows into the toolbar
/// where it stands. A click on the icon grows it in either icon mode.
public enum SelectionToolbarIconMode: Equatable, Sendable {
  /// The whole toolbar, placed by the setting's ``SelectionToolbarPosition``.
  case off
  /// The icon; only a click grows it.
  case click
  /// The icon; it grows once the pointer rests on it, never as the pointer passes over it.
  case hover
}

/// What the page pushed for the selection toolbar (`toolbar.set`): whether it is on, which
/// selections bring it up, whether the `toggle` mode shows its status HUD, whether a small icon
/// stands in for it first and where it appears, the apps it stays out of, and the commands it
/// offers (the enabled commands that read the selection, in command-list order).
public struct SelectionToolbarSettings: Equatable, Sendable {
  public struct Command: Equatable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
      self.id = id
      self.name = name
    }
  }

  public var enabled: Bool
  public var activation: SelectionActivation
  public var showHud: Bool
  public var smallIcon: SelectionToolbarIconMode
  /// Where the whole toolbar appears when it comes up at once (``smallIcon`` off).
  public var position: SelectionToolbarPosition
  public var excludedBundleIds: Set<String>
  public var commands: [Command]

  public init(
    enabled: Bool, activation: SelectionActivation, showHud: Bool,
    smallIcon: SelectionToolbarIconMode, position: SelectionToolbarPosition,
    excludedBundleIds: Set<String>, commands: [Command]
  ) {
    self.enabled = enabled
    self.activation = activation
    self.showHud = showHud
    self.smallIcon = smallIcon
    self.position = position
    self.excludedBundleIds = excludedBundleIds
    self.commands = commands
  }

  public init(_ params: ToolbarSetParams) {
    let smallIcon: SelectionToolbarIconMode =
      switch params.smallIcon {
      case .off: .off
      case .click: .click
      case .hover: .hover
      }
    let position: SelectionToolbarPosition =
      switch params.position {
      case .pointer: .pointer
      case .above: .above
      case .below: .below
      }
    self.init(
      enabled: params.enabled,
      activation: SelectionActivation(
        mode: params.activation, keys: Set(params.activationKeys)),
      showHud: params.showHud, smallIcon: smallIcon, position: position,
      excludedBundleIds: Set(params.excludedBundleIds),
      commands: params.commands.map { Command(id: $0.id, name: $0.name) })
  }
}

/// Whether a left mouse-up in another app may have ended a text selection: a drag, a double or
/// triple click (word, line), or a shift-click that extends a selection. A plain click only
/// places the caret, so it never asks Accessibility.
public enum SelectionGesture {
  /// Pointer travel, in points, below which a press and release count as a click.
  public static let minimumDragDistance = 4.0

  /// `down` is where the button went down (nil when the press was not seen), `up` where it
  /// came up, both in the same global points.
  public static func mayHaveSelected(
    down: CGPoint?, up: CGPoint, clickCount: Int, shift: Bool
  ) -> Bool {
    if clickCount >= 2 || shift { return true }
    guard let down else { return false }
    return hypot(up.x - down.x, up.y - down.y) >= minimumDragDistance
  }
}

/// What the shell knows before it asks Accessibility whether the frontmost app has a selection.
public struct SelectionToolbarContext: Equatable, Sendable {
  /// The toolbar setting; false until the page first pushes it.
  public var enabled: Bool
  /// The app is trusted for Accessibility.
  public var trusted: Bool
  public var frontmostBundleId: String?
  /// This app's bundle id: its own windows never get the toolbar.
  public var ownBundleId: String?
  public var excludedBundleIds: Set<String>
  /// Secure event input is on (a password field anywhere has the keyboard).
  public var secureInput: Bool

  public init(
    enabled: Bool, trusted: Bool, frontmostBundleId: String?, ownBundleId: String?,
    excludedBundleIds: Set<String>, secureInput: Bool
  ) {
    self.enabled = enabled
    self.trusted = trusted
    self.frontmostBundleId = frontmostBundleId
    self.ownBundleId = ownBundleId
    self.excludedBundleIds = excludedBundleIds
    self.secureInput = secureInput
  }
}

/// The answer of the Accessibility presence check: only whether the focused element has a
/// selection, its length and where it is. The selected text itself is never read here.
public enum SelectionProbe: Equatable, Sendable {
  /// No focused element, no selection attribute, or the app did not answer in time.
  case none
  /// The focused element is a secure text field.
  case secureField
  /// A selection of `length` characters (UTF-16, as Accessibility counts them); `bounds` in
  /// Quartz points (origin top-left of the primary display, y down) when the app reports them.
  case selected(length: Int, bounds: CGRect?)
  /// An opaque editor's Copy command suggests a selection, but exposes no range or bounds.
  /// The action still has to verify that the selection copies as text.
  case unmeasured
  /// A cell-based table reports a non-empty cell selection, without reading cell contents.
  case cells
}

/// When the selection toolbar appears (grill decision Q4): only over a non-empty selection in
/// another app the user did not exclude, with Accessibility trusted, and never while a
/// password field or secure input has the keyboard.
public enum SelectionToolbarRules {
  /// Whether a gesture's mouse-up is worth an Accessibility check at all.
  public static func shouldProbe(_ context: SelectionToolbarContext) -> Bool {
    guard context.enabled, context.trusted, !context.secureInput else { return false }
    guard let app = context.frontmostBundleId else { return true }
    return app != context.ownBundleId && !context.excludedBundleIds.contains(app)
  }

  /// Whether the check found a selection to offer the toolbar for.
  public static func shows(_ probe: SelectionProbe) -> Bool {
    switch probe {
    case .selected(let length, _): return length > 0
    case .unmeasured, .cells: return true
    case .none, .secureField: return false
    }
  }
}
