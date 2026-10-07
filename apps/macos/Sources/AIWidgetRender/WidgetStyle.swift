import AIWidgetModel
import SwiftUI
import WidgetKit

/// How the contract's semantic tokens look. Apps choose meaning, never a color: the tokens map to
/// the system palette, so a widget follows light and dark appearance, and one app cannot imitate
/// another's or the system's chrome. The one exception is `accent`, the app's own identity color
/// (``SwiftUICore/View/widgetAccent(_:)``), which `accent` here receives already resolved.
extension WidgetColor {
  public func color(accent: Color) -> Color {
    switch self {
    case .primary: .primary
    case .secondary: .secondary
    case .accent: accent
    case .destructive: .red
    case .success: .green
    case .warning: .orange
    }
  }
}

extension WidgetBackground {
  /// A stack's fill: a token's tint, or the system's grouped fill for `containerBackground`.
  func style(accent: Color) -> AnyShapeStyle {
    switch self {
    case .containerBackground: AnyShapeStyle(.fill.tertiary)
    case .primary: AnyShapeStyle(Color.primary.opacity(0.12))
    case .secondary: AnyShapeStyle(Color.secondary.opacity(0.12))
    case .accent: AnyShapeStyle(accent.opacity(0.18))
    case .destructive: AnyShapeStyle(Color.red.opacity(0.18))
    case .success: AnyShapeStyle(Color.green.opacity(0.18))
    case .warning: AnyShapeStyle(Color.orange.opacity(0.18))
    }
  }
}

extension WidgetTextStyle {
  var font: Font {
    switch self {
    case .largeTitle: .largeTitle
    case .title: .title
    case .title2: .title2
    case .title3: .title3
    case .headline: .headline
    case .subheadline: .subheadline
    case .body: .body
    case .callout: .callout
    case .footnote: .footnote
    }
  }
}

extension WidgetFontWeight {
  var weight: Font.Weight {
    switch self {
    case .regular: .regular
    case .medium: .medium
    case .semibold: .semibold
    case .bold: .bold
    }
  }
}

extension WidgetNode.Vstack.Alignment {
  var alignment: HorizontalAlignment {
    switch self {
    case .leading: .leading
    case .center: .center
    case .trailing: .trailing
    }
  }
}

extension WidgetNode.Hstack.Alignment {
  var alignment: VerticalAlignment {
    switch self {
    case .top: .top
    case .center: .center
    case .bottom: .bottom
    }
  }
}

extension WidgetNode.Zstack.Alignment {
  var alignment: Alignment {
    switch self {
    case .center: .center
    case .top: .top
    case .bottom: .bottom
    case .leading: .leading
    case .trailing: .trailing
    case .topLeading: .topLeading
    case .topTrailing: .topTrailing
    case .bottomLeading: .bottomLeading
    case .bottomTrailing: .bottomTrailing
    }
  }
}

extension View {
  /// The optional token as a foreground; none keeps the inherited style. Accent content joins
  /// the accent group when the system renders the widget accented.
  @ViewBuilder
  func foreground(_ color: WidgetColor?, accent: Color) -> some View {
    if let color {
      foregroundStyle(color.color(accent: accent)).widgetAccentable(color == .accent)
    } else {
      self
    }
  }

  /// A stack's padding and fill, both optional.
  @ViewBuilder
  func stackChrome(padding: Double?, background: WidgetBackground?, accent: Color) -> some View {
    let padded = padding.map { AnyView(self.padding($0)) } ?? AnyView(self)
    if let background {
      padded.background(background.style(accent: accent), in: RoundedRectangle(cornerRadius: 10))
    } else {
      padded
    }
  }
}
