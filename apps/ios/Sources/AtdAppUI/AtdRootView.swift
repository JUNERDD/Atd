import SwiftUI

/// The app's root: the 指令 and 我的 tabs.
public struct AtdRootView: View {
  public init() {}

  public var body: some View {
    TabView {
      Tab(String(localized: "tab.commands", bundle: .module), systemImage: "wand.and.sparkles") {
        Color.clear
      }
      Tab(String(localized: "tab.me", bundle: .module), systemImage: "person.crop.circle") {
        Color.clear
      }
    }
  }
}
