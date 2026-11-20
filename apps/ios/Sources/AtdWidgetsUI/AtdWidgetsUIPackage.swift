import AppIntents
import AtdAutomations
import AtdCameraUI
import AtdIntents
import AtdMiniApps

/// The App Intents the widget extension declares, all from the feature modules it links.
/// `Widgets/AtdWidgetsBundle.swift` includes this package.
///
/// This module defines no intents: the app declares every intent of every package module in its
/// build, this one's included, but does not link this module, so it could not run them. A
/// widget's intents (buttons, controls, configuration) live in a feature module the app links
/// too (`AtdIntentsPackage` has the rule), and a module that adds intents adds its package here.
/// Widget views use the feature tables in `Resources/` (`Entry`, `MiniApps`, `Automations`, …)
/// through `Bundle.module`.
public struct AtdWidgetsUIPackage: AppIntentsPackage {
  public static var includedPackages: [any AppIntentsPackage.Type] {
    [
      AtdIntentsPackage.self, AtdCameraUIPackage.self, AtdMiniAppsPackage.self,
      AtdAutomationsPackage.self,
    ]
  }
}
