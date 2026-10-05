import AIWidgetModel
import SwiftUI
import WidgetKit

/// The extension declares two fixed widget kinds: "App Widget", whose instances each show one
/// widget of a user app, and "My Apps" (``LauncherWidget``), a launcher of the apps. Every kind
/// must be fixed at build time: macOS keeps the entries it first read from an extension until the
/// extension changes version or is registered anew (create-app plan, T1c), so a kind per app made
/// from the catalog would never show a new app. A fixed kind whose content follows the apps is
/// fine. The apps show instead in the App Widget's preview (``AppWidgetProvider``) and picker,
/// which opens as soon as the widget is added, and in the launcher's tiles.
@main
struct AtdWidgetBundle: WidgetBundle {
  var body: some Widget {
    AppWidget()
    LauncherWidget()
  }
}

struct AppWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: WidgetKinds.app, intent: AppWidgetIntent.self, provider: AppWidgetProvider()
    ) { entry in
      AppWidgetView(entry: entry)
    }
    .configurationDisplayName(
      LocalizedStringResource("widget.displayName")
    )
    .description(LocalizedStringResource("widget.description"))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .promptsForUserConfiguration()
  }
}
