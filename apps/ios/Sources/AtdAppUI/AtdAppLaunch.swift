import AppIntents
import AtdAutomations
import AtdCameraUI
import AtdIntents
import AtdMiniApps

/// What the app sets up once while it launches, before its first scene appears.
public enum AtdAppLaunch {
  /// Call from the App's `init()`. `shortcuts` is Atd's `AppShortcutsProvider`: App Shortcuts
  /// are read only from the App target's own sources, so the provider lives there, and the package
  /// refreshes it through `AtdShortcuts`.
  public static func prepare<Shortcuts: AppShortcutsProvider>(shortcuts: Shortcuts.Type) {
    AtdShortcuts.install { Shortcuts.updateAppShortcutParameters() }
    // Background task handlers must be registered before launch finishes.
    AutomationLaunch.prepare()
    CameraLaunch.prepare()
  }
}

/// The App Intents the app declares through the package: its own (`Intents/`) and the ones it
/// shares with the widget extension (AtdIntents, AtdMiniApps) and the capture extension
/// (AtdCameraUI). `App/AtdApp.swift` includes this package. A module that adds intents adds its
/// own package here, and in `AtdWidgetsUIPackage` when the widget extension links it too.
nonisolated public struct AtdAppUIPackage: AppIntentsPackage {
  public static var includedPackages: [any AppIntentsPackage.Type] {
    [
      AtdIntentsPackage.self, AtdCameraUIPackage.self, AtdMiniAppsPackage.self,
      AtdAutomationsPackage.self,
    ]
  }
}
