import AppIntents
import AtdWidgetsUI
import SwiftUI
import WidgetKit

/// The widget extension: Atd's Home and Lock Screen widgets, its controls and its Live
/// Activities, all from the `AtdWidgetsUI` package target.
@main
struct AtdWidgetsBundle: WidgetBundle {
  var body: some Widget {
    CommandsWidget()
    LockScreenWidget()
    MiniAppWidget()
    AskControl()
    BriefingControl()
    CaptureControl()
    BriefingActivityWidget()
    AutomationActivityWidget()
    FocusActivityWidget()
  }
}

/// The App Intents this extension declares (AtdWidgetsUIPackage lists the modules).
struct AtdWidgetsPackage: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] {
    [AtdWidgetsUIPackage.self]
  }
}
