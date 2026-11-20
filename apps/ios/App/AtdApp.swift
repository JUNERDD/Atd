import AtdAppUI
import SwiftUI

/// The App target stays thin: all behavior lives in the `AtdMobile` package. It declares only what
/// the system reads from the app's own sources, the App Shortcuts (`AtdAppShortcuts`); the build
/// merges the package's App Intents into the app's metadata (Package.swift).
@main
struct AtdApp: App {
  init() {
    AtdAppLaunch.prepare(shortcuts: AtdAppShortcuts.self)
  }

  var body: some Scene {
    WindowGroup {
      AtdRootView()
    }
  }
}
