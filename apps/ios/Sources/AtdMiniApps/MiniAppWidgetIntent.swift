import AppIntents

/// Which mini app a placed widget shows.
///
/// Stub (F0a) of the pattern for a widget configuration intent. The app declares every intent of
/// every package module in its build, the widget extension's included, so a configuration intent
/// lives in a module both link: then the app, which the system may ask about the intent, has the
/// same type as the extension. Its copy is in `MainBundle/MiniAppIntents.xcstrings`, which
/// project.yml compiles into both. WS-D replaces the text parameter with a mini-app entity.
public struct MiniAppWidgetIntent: WidgetConfigurationIntent {
  public static let title = LocalizedStringResource(
    "miniAppWidget.title", table: "MiniAppIntents")

  @Parameter(title: LocalizedStringResource("miniAppWidget.app", table: "MiniAppIntents"))
  public var app: String?

  public init() {}
}

/// This module's App Intents, listed by the app's and the widget extension's packages.
public struct AtdMiniAppsPackage: AppIntentsPackage {}
