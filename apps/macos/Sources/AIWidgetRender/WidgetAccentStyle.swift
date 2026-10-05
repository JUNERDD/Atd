import AIWidgetModel
import SwiftUI
import WidgetKit

extension EnvironmentValues {
  /// The color the `accent` token draws with below ``SwiftUICore/View/widgetAccent(_:)``.
  @Entry var widgetAccentColor: Color = .accentColor
}

extension View {
  /// Gives the tree's `accent` token the app's accent color, adapted to the light or dark
  /// appearance (``WidgetAccent/adapted(dark:)``); nil keeps the system accent. Only full-color
  /// rendering uses it: in the accented and vibrant modes the system recolors the whole widget,
  /// so the token stays the system accent there and accent content is marked accentable instead
  /// (``WidgetColor/foreground``).
  public func widgetAccent(_ accent: WidgetAccent?) -> some View {
    modifier(WidgetAccentModifier(accent: accent))
  }
}

private struct WidgetAccentModifier: ViewModifier {
  let accent: WidgetAccent?
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode

  func body(content: Content) -> some View {
    content.environment(\.widgetAccentColor, color)
  }

  private var color: Color {
    guard let accent, renderingMode == .fullColor else { return .accentColor }
    let adapted = accent.adapted(dark: colorScheme == .dark)
    return Color(.sRGB, red: adapted.red, green: adapted.green, blue: adapted.blue)
  }
}
