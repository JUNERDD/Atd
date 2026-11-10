import AICore
import AppKit
import Carbon.HIToolbox
import Observation
import SwiftUI

/// The recording card's lightbox content (``IslandLightboxContent``): the recording full screen
/// over the scrim (``IslandRecordingLightboxView``), worked on as on the card. It draws the card
/// model the card draws (``IslandRecordingCardModel``): the one player, playhead, trim, steps
/// and footer feedback, so what changes here shows on the card under the scrim and stays when
/// the lightbox closes.
///
/// Keys while it has the keyboard: Space plays or pauses (unless a button has the keyboard
/// focus, which Space presses), ← and → move the playhead a second (⇧ five), I sets the kept
/// range's start at the playhead and O its end, ⌘C copies and ⌘↩ attaches the kept range, as the
/// card's footer does. Escape is left to the lightbox, which closes.
final class IslandRecordingLightbox: IslandLightboxContent {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let lightbox: IslandLightboxModel
  /// What only the lightbox shows: the steps panel's toggle and the timeline's hover frame.
  let state = IslandRecordingLightboxState()

  init(card: IslandRecordingCardModel, labels: IslandRecordingLabels, lightbox: IslandLightboxModel)
  {
    self.card = card
    self.labels = labels
    self.lightbox = lightbox
  }

  var view: AnyView {
    AnyView(
      IslandRecordingLightboxView(card: card, labels: labels, lightbox: lightbox, state: state))
  }

  func key(_ event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch Int(event.keyCode) {
    case kVK_Space where modifiers.isEmpty && !state.controlFocused:
      card.togglePlay()
      return true
    case kVK_LeftArrow, kVK_RightArrow:
      guard modifiers.isEmpty || modifiers == .shift else { return false }
      let seconds = modifiers == .shift ? 5.0 : 1.0
      card.seek(card.playhead + (Int(event.keyCode) == kVK_RightArrow ? seconds : -seconds))
      return true
    default:
      break
    }
    guard modifiers.isEmpty else { return false }
    switch Self.letter(event) {
    case "i": card.trimAtPlayhead(.start)
    case "o": card.trimAtPlayhead(.end)
    default: return false
    }
    return true
  }

  /// ⌘C copies the kept range and ⌘↩ attaches it (``IslandShellFooterKey``), as on the card.
  func keyEquivalent(_ event: NSEvent) -> Bool {
    guard let key = IslandShellFooterKey(event, field: nil) else { return false }
    switch key {
    case .copy: card.onEvent(.copy(card.state.trim))
    case .attach: card.onEvent(.attach(card.state.trim))
    }
    return true
  }

  /// Closing pauses, lets go of a handle still held and hides the hover frame; the card keeps
  /// everything else.
  func willClose() {
    state.bubble.stop()
    card.pause()
    card.endDrag()
  }

  /// The letter key `event` presses: by character, so I and O are found on any Latin layout,
  /// else by the key's place for a layout without them.
  private static func letter(_ event: NSEvent) -> Character? {
    if let character = event.charactersIgnoringModifiers?.lowercased().first,
      character.isASCII, character.isLetter
    {
      return character
    }
    switch Int(event.keyCode) {
    case kVK_ANSI_I: return "i"
    case kVK_ANSI_O: return "o"
    default: return nil
    }
  }
}

/// The lightbox's own state, apart from the card model it shares with the card.
@Observable
final class IslandRecordingLightboxState {
  /// The steps panel shows, where the window is wide enough for it.
  var stepsShown = true
  /// The timeline's hover frame, the lightbox's larger one.
  let bubble = IslandRecordingFrameBubble(.lightbox)
  /// One of the lightbox's buttons has the keyboard focus (Full Keyboard Access), so Space
  /// presses it rather than playing (``IslandControlFocus``).
  @ObservationIgnored var controlFocused = false
}
