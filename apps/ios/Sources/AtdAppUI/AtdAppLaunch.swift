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
    EntryRuntime.start()
    AutomationLaunch.prepare()
    CameraLaunch.prepare()
    MiniAppDebug.launch()
  }
}
