import AICore
import AppKit
import Carbon.HIToolbox
import Observation
import SwiftUI

/// Whether a lightbox's side panel shows (``IslandLightboxPanel``): the recording's steps, the long
/// screenshot's text commands' result. Each lightbox content owns one for its kind.
///
/// The person's explicit choice (the top bar's toggle, ⌥⌘I, the panel's hide button, and closing
/// its drawer) is remembered per kind across openings in the user defaults, shown until they ever
/// hide it. A run the person starts, or a click on a result on the image, opens it without
/// changing that choice (``open()``). While it is hidden, a result arriving marks it ``unseen``,
/// which the toggle shows as a dot until it shows again. Every change moves the panel and what
/// lays out beside it on the steps toggle's spring, or at once under Reduce Motion, and tells the
/// content (``onChange``) inside that animation, so a layout it derives moves with it.
@Observable
final class IslandLightboxPanelState {
  enum Kind: String {
    case recording, longScreenshot
  }

  /// The person's choice, or a run's opening.
  private(set) var shown: Bool
  /// A result arrived while it was hidden.
  private(set) var unseen = false
  /// Its change happened; called inside the change's animation.
  @ObservationIgnored var onChange: () -> Void = {}
  @ObservationIgnored private let key: String
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let reduceMotion: Bool

  init(kind: Kind, reduceMotion: Bool, defaults: UserDefaults = .standard) {
    key = "island.lightbox.\(kind.rawValue).panelShown"
    self.defaults = defaults
    self.reduceMotion = reduceMotion
    shown = defaults.object(forKey: key) as? Bool ?? true
  }

  /// Where the panel stands in a work area `area` whose bars leave `between` free, while it has
  /// something to show (`present`).
  func placement(present: Bool = true, in area: CGRect, between: ClosedRange<CGFloat>)
    -> IslandMetrics.LightboxPanelPlacement
  {
    IslandMetrics.lightboxPanel(shown: shown && present, in: area, between: between)
  }

  /// The toggle or ⌥⌘I.
  func toggle() { set(!shown, remember: true) }

  /// The hide button, or the drawer closed by Escape or a click outside it.
  func hide() { set(false, remember: true) }

  /// A run the person started, or a result clicked on the image: the panel shows it, keeping the
  /// remembered choice. The content's layout follows even when it already showed, since what it
  /// shows may have just appeared.
  func open() { set(true, remember: false) }

  /// What the panel shows went (a discarded review), its choice unchanged: the content's layout
  /// follows on the panel's spring.
  func follow() { set(shown, remember: false) }

  /// A result arrived: while the panel is hidden, its toggle marks it.
  func noteArrival() {
    if !shown, !unseen { unseen = true }
  }

  private func set(_ next: Bool, remember: Bool) {
    if remember { defaults.set(next, forKey: key) }
    withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 1)) {
      if next { unseen = false }
      if shown != next { shown = next }
      onChange()
    }
  }

  /// ⌥⌘I, which shows or hides the panel in both lightboxes: by character, so I is found on any
  /// Latin layout, else by the key's place. It never clashes with the recording's I (a trim key
  /// without modifiers) or the long screenshot's keys.
  static func toggles(_ event: NSEvent) -> Bool {
    guard
      event.modifierFlags.intersection([.command, .control, .option, .shift])
        == [.command, .option]
    else { return false }
    if let character = event.charactersIgnoringModifiers?.lowercased().first,
      character.isASCII, character.isLetter
    {
      return character == "i"
    }
    return Int(event.keyCode) == kVK_ANSI_I
  }
}
