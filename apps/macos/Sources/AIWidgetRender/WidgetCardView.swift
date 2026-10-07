import AICore
import AIWidgetModel
import AppKit
import SwiftUI

/// The geometry of a widget drawn outside WidgetKit, as macOS lays desktop widgets out.
public enum WidgetCard {
  /// The content margin inside the card.
  public static let padding: CGFloat = 16
  /// The card's continuous corner radius.
  public static let cornerRadius: CGFloat = 22

  /// The family's size in points.
  public static func size(of family: WidgetFamily) -> CGSize {
    switch family {
    case .systemSmall: CGSize(width: 170, height: 170)
    case .systemMedium: CGSize(width: 364, height: 170)
    case .systemLarge: CGSize(width: 364, height: 382)
    }
  }

  /// The sizes a desktop pin shows the family's layout at (decision D5 v1.6). A pin resizes
  /// freely within the ranges of the families its widget declares, and shows the largest family
  /// whose range holds its size, laid out at that size and never scaled. The bounds stop where a
  /// widget tree (at most eight list rows, a chart, text and gauges at fixed sizes) can no longer
  /// fill the card:
  /// - 320 pt wide: the wide layouts (medium, large) give up at most 12% of the 332 pt their
  ///   content was laid out for before the small one, laid out for 138 pt, takes over.
  /// - 270 pt tall: the short layouts (small, medium) hold a header and the eight single-line rows
  ///   a list may have, so a taller pin goes to the large layout.
  /// - 480 × 440 pt at most, 1.3 times the wide width and 1.15 times the large height: a header
  ///   and eight two-line rows, or a chart, still fill it; beyond, lists leave the card's edge
  ///   empty, and the pin would crowd a 13-inch desktop.
  public static func pinRange(of family: WidgetFamily) -> DesktopPinGeometry.SizeRange {
    switch family {
    case .systemSmall: range(width: 170...320, height: 170...270)
    case .systemMedium: range(width: 320...480, height: 170...270)
    case .systemLarge: range(width: 320...480, height: 270...440)
    }
  }

  /// The sizes a desktop pin shows the app's tile at. The small tile, its icon above its name,
  /// from 170 to 320 pt wide; it shows nothing more when taller, so it stays 170 pt tall. The
  /// medium one, its icon beside its name and description, from 320 pt wide: for an app
  /// `described`, to 420 pt, where description lines reach a comfortable length, and 240 pt tall,
  /// which holds the longest description (500 characters) at its narrowest; without one, it has
  /// only the name to show and keeps the medium size, 364 × 170. A tile is never large; that
  /// family gets the medium tile's range.
  public static func tileRange(of family: WidgetFamily, described: Bool)
    -> DesktopPinGeometry.SizeRange
  {
    switch family {
    case .systemSmall: range(width: 170...320, height: 170...170)
    case .systemMedium, .systemLarge:
      described
        ? range(width: 320...420, height: 170...240) : range(width: 320...364, height: 170...170)
    }
  }

  private static func range(width: ClosedRange<Double>, height: ClosedRange<Double>)
    -> DesktopPinGeometry.SizeRange
  {
    DesktopPinGeometry.SizeRange(
      min: WindowSize(width: width.lowerBound, height: height.lowerBound),
      max: WindowSize(width: width.upperBound, height: height.upperBound))
  }
}

/// The card a widget draws on outside WidgetKit: the content margin, the continuous corner and
/// the widget background (`.fill.tertiary` over the window background), which follow the color
/// scheme in the environment, at the family's size or filling the space it is given. The shell's
/// widget previews, a desktop pin and the image dragged out of the panel to pin one all draw on
/// it, so the three match; content sits at the top leading corner, as in a widget.
public struct WidgetCardView<Content: View>: View {
  /// Nil fills the space the card is given.
  private let size: CGSize?
  private let content: Content

  public init(family: WidgetFamily, @ViewBuilder content: () -> Content) {
    size = WidgetCard.size(of: family)
    self.content = content()
  }

  /// A card that fills the space it is given, as a desktop pin's does: the pin's window sets the
  /// size, and the content lays itself out in it at its own type and spacing.
  public init(@ViewBuilder content: () -> Content) {
    size = nil
    self.content = content()
  }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: WidgetCard.cornerRadius, style: .continuous)
    framed(content.padding(WidgetCard.padding))
      .background(.fill.tertiary, in: shape)
      .background(Color(nsColor: .windowBackgroundColor), in: shape)
  }

  @ViewBuilder
  private func framed(_ padded: some View) -> some View {
    if let size {
      padded.frame(width: size.width, height: size.height, alignment: .topLeading)
    } else {
      padded.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }
}
