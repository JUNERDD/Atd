import CoreGraphics

/// The command island's geometry: the HUD a command shows while it runs without the panel, one
/// glass shape at the bottom of the screen that is a capsule while something runs and a card
/// while its options are chosen. Capsules keep the progress HUD's geometry, the selection
/// toolbar's row (``SelectionToolbarLayout``: 28 pt controls in 4 pt of padding, 2 pt apart,
/// the 16 pt grip); the card is the mini panel's commands card (18 pt corner, 28 pt rows).
public enum IslandMetrics {
  /// A capsule's height: a 28 pt control in 4 pt of padding.
  public static let capsuleHeight = controlSide + padding * 2
  public static let padding = SelectionToolbarLayout.padding
  /// Between a capsule's items.
  public static let gap = SelectionToolbarLayout.gap
  /// A round button's side, as the toolbars' (`AnnotationToolbarButton.side`).
  public static let controlSide = 28.0
  public static let gripWidth = SelectionToolbarLayout.gripWidth
  public static let glyphSide = MiniPanelMetrics.glyphSide
  /// The longest command name before it is cut with an ellipsis.
  public static let maxCommandWidth = 300.0
  /// The longest values summary on the working capsule's chip.
  public static let maxSummaryWidth = 220.0
  /// A notice wraps past this width, to at most ``maxMessageLines`` lines.
  public static let maxMessageWidth = 420.0
  public static let maxMessageLines = 2
  /// How far a capsule too wide for ``maxShape`` cuts its values chip, its command name and a
  /// notice's message, in that order (``CapsuleLimits/fitting(overflow:command:summary:message:)``).
  public static let minSummaryWidth = 48.0
  public static let minCommandWidth = 64.0
  public static let minMessageWidth = 160.0

  /// The widths a capsule's texts may take before they are cut with an ellipsis.
  public struct CapsuleLimits: Equatable, Sendable {
    public var command = maxCommandWidth
    public var summary = maxSummaryWidth
    public var message = maxMessageWidth

    public init() {}

    /// The limits that take `overflow` points off a capsule wider than ``maxShape`` whose
    /// command name, values chip and message take `command`, `summary` and `message` points now
    /// (nil for a text it does not show): the chip gives way first, down to ``minSummaryWidth``,
    /// then the name, down to ``minCommandWidth``, then the message, down to ``minMessageWidth``.
    /// The Escape hint and the buttons never give way.
    public static func fitting(
      overflow: Double, command: Double?, summary: Double?, message: Double?
    ) -> CapsuleLimits {
      var left = max(overflow, 0)
      var limits = CapsuleLimits()
      func cut(_ width: Double?, floor: Double) -> Double? {
        guard let width else { return nil }
        let cut = min(left, max(width - floor, 0))
        left -= cut
        return (width - cut).rounded(.down)
      }
      if let summary = cut(summary, floor: minSummaryWidth) { limits.summary = summary }
      if let command = cut(command, floor: minCommandWidth) { limits.command = command }
      if let message = cut(message, floor: minMessageWidth) { limits.message = message }
      return limits
    }
  }
  /// The charge meter of the press capsule.
  public static let meterWidth = 36.0
  public static let meterHeight = 4.0

  // The options card.
  public static let cardRadius = MiniPanelMetrics.cardRadius
  public static let cardPadding = MiniPanelMetrics.cardPadding
  public static let rowHeight = MiniPanelMetrics.rowHeight
  public static let rowRadius = MiniPanelMetrics.rowRadius
  public static let rowPadding = MiniPanelMetrics.rowPadding
  /// The card's title row and its filter field.
  public static let headerHeight = 28.0
  public static let filterHeight = 28.0
  public static let footerHeight = 32.0
  public static let sectionGap = 4.0
  /// The card is as wide as its widest row or footer within these bounds.
  public static let minCardWidth = 300.0
  public static let maxCardWidth = 560.0
  /// More rows than this scroll inside the card.
  public static let maxVisibleRows = 8

  /// The largest shape the island takes: the widest notice or card, the tallest card.
  public static let maxShape = WindowSize(width: 640, height: 400)
  /// Transparent room around the shape at rest, for its glass shadow and its overshoot.
  public static let inset = 24.0

  /// The fixed canvas every shape is drawn in: the largest shape at its overshoot
  /// (``MiniPanelChoreography/followLimit``) with ``inset`` around it.
  public static var canvas: WindowSize {
    let limit = MiniPanelChoreography.followLimit
    return WindowSize(
      width: (maxShape.width * limit + inset * 2).rounded(.up),
      height: (maxShape.height * limit + inset * 2).rounded(.up))
  }

  /// The card's height for `rows` visible rows (at least one: the no-match row stands in), with
  /// a filter field or without.
  public static func cardHeight(rows: Int, filter: Bool) -> Double {
    let shown = Double(min(max(rows, 1), maxVisibleRows))
    return cardPadding * 2 + headerHeight + (filter ? filterHeight + sectionGap : 0)
      + shown * rowHeight + sectionGap + footerHeight
  }

  /// The card's width for content that would take `ideal` points.
  public static func cardWidth(ideal: Double) -> Double {
    min(max(ideal.rounded(.up), minCardWidth), maxCardWidth)
  }

  /// Where a shape of `size` rests in the canvas (y down): centred, its bottom ``inset`` above the
  /// canvas's bottom edge, so every shape grows up out of the same place.
  public static func rest(_ size: WindowSize) -> CGRect {
    let canvas = canvas
    return CGRect(
      x: (canvas.width - size.width) / 2, y: canvas.height - inset - size.height,
      width: size.width, height: size.height)
  }

  /// A shape's corner: a capsule's half height, the card's radius.
  public static func corner(_ size: WindowSize, card: Bool) -> Double {
    card ? cardRadius : size.height / 2
  }
}

/// The island's motion. It is not resident UI, so it has no resting pill: it enters at its first
/// shape's size as the selection toolbar does (``SelectionToolbarEntrance``: a brisk spring from
/// 0.9 of its size, rising out of its bottom edge, while it fades in), its content arriving with
/// the shape; it leaves as one piece, its content staying in the shape as both shrink a little
/// toward the bottom edge while the island fades out, so the glass never shows empty, and a show
/// before it is gone turns it back from where it is. Between contents it morphs as
/// the mini panel's body does (``MiniPanelChoreography``), with the shape's thickness on its
/// height and its length on its width: content leaves before the shape moves and arrives after
/// it, centred in the shape and scaling with it. Reduce Motion fades it in and out without scale.
public enum IslandChoreography {
  /// The shape's springs from a shape of `from` to one of `to`. A growing shape opens as the
  /// mini panel's capsule does; a shrinking one waits for its content as the drop card does
  /// going back to the invite.
  public static func shape(from: WindowSize, to: WindowSize, reduceMotion: Bool = false)
    -> MiniPanelShapeMotion
  {
    let shrinks = to.width * to.height < from.width * from.height
    return MiniPanelChoreography.shape(shrinks ? .untarget : .expand, reduceMotion: reduceMotion)
  }

  /// How content arrives in a shape and leaves it.
  public static let content = MiniPanelChoreography.content(.expand)

  /// How content that replaces other content arrives: once what was there has left.
  public static var replacing: MiniPanelContentMotion {
    MiniPanelContentMotion(delay: max(content.delay, content.exit), exit: content.exit)
  }

  /// How the first content arrives as the island enters: at once, its opacity and blur clearing
  /// alongside the shape's spring and the window's fade, so the island never shows as an empty
  /// shell.
  public static let entering = MiniPanelContentMotion(delay: 0, exit: content.exit)

  /// A change within the same content (a chip arriving, the language): the shape follows on the
  /// expand springs while the content changes in place.
  public static let resize = MiniPanelChoreography.shape(.expand)

  /// Leaving, the shape shrinks and the window fades out, its content in it, eased in over this
  /// long: quicker than the entrance, as dismissals are.
  public static let exitDuration = 0.18

  /// How long a leaving content stays mounted: its exit with a frame to spare.
  public static let unmountDelay = content.exit + 0.1
}
