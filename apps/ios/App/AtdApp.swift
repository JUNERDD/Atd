import AtdAppUI
import SwiftUI

/// The App target stays thin: all behavior lives in the `AtdMobile` package.
@main
struct AtdApp: App {
  var body: some Scene {
    WindowGroup {
      AtdRootView()
    }
  }
}
