import AICore
import AppKit
import Observation
import SwiftUI

/// What one result card shows in its lightbox (``IslandLightbox``): the long screenshot or the
/// recording. The card's presenter makes it for the card model the card and the lightbox share,
/// so a trim, a cover, an annotation, the playhead or a footer's feedback changed in one shows in
/// the other without being copied.
///
/// The lightbox owns the window, the scrim and the motion's timing (``IslandLightboxModel``);
/// the content owns everything over the scrim: its media, which it places at the model's
/// ``IslandLightboxModel/origin`` until the model says it is ``IslandLightboxModel/Phase/shown``
/// and back there while it is leaving, and its chrome, which shows while
/// ``IslandLightboxModel/chromeShown``.
protocol IslandLightboxContent: AnyObject {
  /// The media and its chrome, laid out in the lightbox's whole size (top-left origin).
  var view: AnyView { get }
  /// A key press while the lightbox is key: true when it was taken. Escape that steps back inside
  /// the content (an edit, a mode) is taken; Escape it does not take closes the lightbox.
  func key(_ event: NSEvent) -> Bool
  /// A key equivalent (⌘C, ⌘↩, ⌘Z…) while the lightbox is key: true when it was taken.
  func keyEquivalent(_ event: NSEvent) -> Bool
  /// The lightbox starts closing (with motion or without): open edits end, a drag lets go.
  func willClose()
}

/// The lightbox's state for its content: how far in or out it is, where the card's media is, its
/// size and the work area inside it.
@Observable
final class IslandLightboxModel {
  enum Phase: Equatable {
    /// Just ordered in: the media stands on the card's (``origin``) and nothing else shows yet.
    case entering
    /// Open: the media in its place, the scrim up.
    case shown
    /// Closing: the media goes back onto the card's, the scrim fades.
    case leaving
  }

  var phase = Phase.entering
  /// The card's media (its preview image, its player) in the lightbox's coordinates (top-left
  /// origin), where the media grows from and goes back to; nil when it is not known, and then the
  /// media fades in and out in place instead.
  var origin: CGRect?
  /// The chrome (bars, side panels) shows: once the media has landed, gone as closing begins.
  var chromeShown = false
  /// The window's size: the whole screen.
  var size = CGSize.zero
  /// The screen's work area inside the window: the menu bar (and the camera housing) above it,
  /// the Dock beside or below it. Chrome stays inside it; the media may use the whole window.
  var safe = EdgeInsets()
  var reduceMotion = false
  /// Asks the lightbox to close, with its motion (the × button, a click on the backdrop).
  @ObservationIgnored var onClose: () -> Void = {}

  func close() { onClose() }

  /// The work area in the lightbox's coordinates.
  var workArea: CGRect {
    CGRect(
      x: safe.leading, y: safe.top, width: max(size.width - safe.leading - safe.trailing, 0),
      height: max(size.height - safe.top - safe.bottom, 0))
  }

  /// Where the media stands now, for the content's media at rest at `destination`: on the card's
  /// while entering and leaving, in place while shown, and always in place under Reduce Motion or
  /// with no known origin (``mediaOpacity`` then fades it).
  func mediaFrame(_ destination: CGRect) -> CGRect {
    guard let origin, !reduceMotion, phase != .shown else { return destination }
    return origin
  }

  /// The media's opacity: whole while it moves; faded in and out when it cannot move.
  var mediaOpacity: Double {
    if origin != nil, !reduceMotion { return 1 }
    return phase == .shown ? 1 : 0
  }

  /// The chrome's opacity (``chromeShown``), for content that fades its own pieces.
  var chromeOpacity: Double { chromeShown ? 1 : 0 }
}
