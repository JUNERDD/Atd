import CoreGraphics

/// The result cards' full-screen preview (the lightbox): the long screenshot or the recording over
/// a dark scrim covering the island's screen, its chrome on glass bars inside the screen's work
/// area. Both lightboxes place their bars by these values; their media and side panels own their
/// own geometry.
extension IslandMetrics {
  /// A bar's height: the top bar's, and the long screenshot's one-row bottom bar's.
  public static let lightboxTopBarHeight = 44.0
  public static let lightboxBottomBarHeight = 48.0
  /// Between the work area's top edge and the top bar.
  public static let lightboxTopInset = 16.0
  /// Between the work area's bottom edge and the bottom bar.
  public static let lightboxBottomInset = 20.0
  /// The bars' text starts this far in from their rounded ends.
  public static let lightboxBarLeading = 18.0
  public static let lightboxBarTrailing = 8.0
  /// The black over the blurred desktop, and its opacity under Reduce Transparency, which has no
  /// blur under it.
  public static let lightboxScrim = 0.55
  public static let lightboxScrimOpaque = 0.9
}

/// The lightbox's motion: the media grows out of the card's own media and back into it on one
/// spring without bounce, while the scrim fades; the chrome follows once the media has landed and
/// goes first. Under Reduce Motion nothing moves: the whole lightbox fades.
extension IslandChoreography {
  public static let lightboxOpen = 0.44
  public static let lightboxClose = 0.38
  public static let lightboxScrimFade = 0.32
  public static let lightboxChromeFade = 0.16
  public static let lightboxReducedFade = 0.16
}
