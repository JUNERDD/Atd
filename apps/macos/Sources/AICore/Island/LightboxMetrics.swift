import CoreGraphics

/// The result cards' full-screen preview (the lightbox): the long screenshot or the recording over
/// a dark scrim covering the island's screen, its chrome on glass bars inside the screen's work
/// area. Both lightboxes place their bars by these values and their side panel by
/// ``lightboxPanel(shown:in:between:)``; their media own their own geometry.
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

/// The lightboxes' one side panel: the recording's steps, the long screenshot's text commands'
/// result. It stands at the work area's right, as wide as the result card
/// (``CaptureResultPlacement/cardWidth``). Where the work area keeps the media column at least the
/// recording bar's minimum width beside it, it docks, from the top bar's top to the bottom bar's
/// bottom, and the media yields it the room; narrower, it is a drawer over the media's right side
/// between the bars, which keep their whole width and place.
extension IslandMetrics {
  public static let lightboxPanelWidth = Double(CaptureResultPlacement.cardWidth)
  /// Between the panel and the work area's right edge.
  public static let lightboxPanelInset = 16.0
  public static let lightboxPanelRadius = 18.0
  /// Between a drawer and the bars above and below it.
  public static let lightboxPanelDrawerGap = 8.0
  /// The narrowest work area the panel docks in: the media column keeps
  /// ``recordingLightboxBarMinWidth`` beside the panel and its insets.
  public static let lightboxPanelDockWidth =
    recordingLightboxBarMinWidth + lightboxPanelWidth + lightboxPanelInset * 2

  /// Where a lightbox's side panel stands, in the lightbox's coordinates (top-left origin).
  public enum LightboxPanelPlacement: Equatable, Sendable {
    /// Hidden, or nothing to show: the media and its bars keep the whole width.
    case hidden
    /// Beside the media: the media column, its bars and its rail lay out left of it.
    case docked(CGRect)
    /// Over the media's right side between the bars: the media and the bars keep their place.
    case drawer(CGRect)

    /// The panel's frame while it shows.
    public var frame: CGRect? {
      switch self {
      case .hidden: nil
      case .docked(let frame), .drawer(let frame): frame
      }
    }

    /// The panel's frame while it docks, which the media lays out left of.
    public var docked: CGRect? {
      if case .docked(let frame) = self { frame } else { nil }
    }

    public var isDrawer: Bool {
      if case .drawer = self { true } else { false }
    }
  }

  /// The panel's place in a lightbox whose work area is `area`, hidden unless `shown`; as a drawer
  /// it stands ``lightboxPanelDrawerGap`` inside `between`, the rows the lightbox's bars leave free
  /// (from the top bar's bottom to the top of what stands above the bottom).
  public static func lightboxPanel(
    shown: Bool, in area: CGRect, between: ClosedRange<CGFloat>
  ) -> LightboxPanelPlacement {
    guard shown else { return .hidden }
    let x = area.maxX - lightboxPanelInset - lightboxPanelWidth
    guard area.width >= lightboxPanelDockWidth else {
      let top = between.lowerBound + lightboxPanelDrawerGap
      let bottom = between.upperBound - lightboxPanelDrawerGap
      return .drawer(
        CGRect(x: x, y: top, width: lightboxPanelWidth, height: max(bottom - top, 0)))
    }
    let top = area.minY + lightboxTopInset
    return .docked(
      CGRect(
        x: x, y: top, width: lightboxPanelWidth,
        height: max(area.maxY - lightboxBottomInset - top, 0)))
  }
}
