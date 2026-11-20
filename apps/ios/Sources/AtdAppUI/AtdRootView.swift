import SwiftUI
import UIKit

/// The app's root: the 指令 and 我的 tabs and, beside them, the round 问 Atd button, which opens
/// the panel over whichever tab is showing. Only this floating bar is Liquid Glass; the pages are
/// ink on paper.
public struct AtdRootView: View {
  @State private var store = AppStore.live()
  @State private var tab = AppTab.commands
  @State private var asking = false
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  public var body: some View {
    TabView(selection: selection) {
      Tab(AppText.string("tab.commands"), systemImage: "wand.and.sparkles", value: .commands) {
        CommandsPage()
      }
      Tab(AppText.string("tab.me"), systemImage: "person.crop.circle", value: .me) {
        MePage()
      }
      Tab(value: .ask, role: .search) {
        Color.clear
      } label: {
        Label {
          Text(AppText.string("tab.ask"))
        } icon: {
          Image(uiImage: Self.mark)
        }
      }
    }
    .tint(.primary)
    .environment(store)
    .sheet(isPresented: $asking) {
      AskSheet().environment(store)
    }
    .alert(store.failure ?? "", isPresented: failureShown) {
      Button(AppText.string("action.ok"), role: .cancel) {}
    }
    .onChange(of: scenePhase) { _, phase in
      // The keyboard may have reported itself, or changed an option, while Atd was away.
      if phase == .active { store.reload() }
    }
  }

  /// Picking 问 Atd opens the panel and leaves the current tab showing.
  private var selection: Binding<AppTab> {
    Binding(
      get: { tab },
      set: { picked in
        if picked == .ask { asking = true } else { tab = picked }
      })
  }

  private var failureShown: Binding<Bool> {
    Binding(get: { store.failure != nil }, set: { if !$0 { store.failure = nil } })
  }

  private static let mark = InkArt.markImage(side: 24)
}

enum AppTab: Hashable {
  case commands, me, ask
}
