import AppIntents
import AtdAppUI
import SwiftUI

/// The App target stays thin: all behavior lives in the `AtdMobile` package. It declares only what
/// the system reads from the app's own sources: the App Shortcuts (`AtdAppShortcuts`) and the root
/// of the app's App Intents (`AtdAppPackage`).
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

/// The App Intents the app declares, all from the package (`AtdAppUIPackage` lists the modules).
struct AtdAppPackage: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] {
    [AtdAppUIPackage.self]
  }
}
