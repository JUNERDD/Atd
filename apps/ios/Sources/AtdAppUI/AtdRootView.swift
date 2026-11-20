import AtdInk
import AtdIntents
import AtdModel
import LockedCameraCapture
import SwiftUI
import UIKit

/// The app's root: the 指令, 小应用, 自动化 and 我的 tabs and, beside them, the round 问 Atd button,
/// which opens the panel over whichever tab is showing. Only this floating bar is Liquid Glass; the
/// pages are ink on paper.
///
/// Deep links, App Intents and the Lock Screen capture extension reach the app as routes
/// (`RouteCenter`); `show(_:)` decides which the root takes and which it leaves to a page.
public struct AtdRootView: View {
  @State private var store = AppStore.live()
  @State private var tab = AppTab.commands
  @State private var ask: AskRequest?
  @State private var camera: CameraEntry?
  /// A command a control ran in Atd (`CommandRunCenter`, A40).
  @State private var run: CommandRunRequest?
  @Environment(\.scenePhase) private var scenePhase
  private let routes = RouteCenter.shared

  public init() {}

  public var body: some View {
    TabView(selection: selection) {
      Tab(AppText.string("tab.commands"), systemImage: "wand.and.sparkles", value: .commands) {
        CommandsPage()
      }
      Tab(AppText.string("tab.miniApps"), systemImage: "square.on.circle", value: .miniApps) {
        MiniAppsPage()
      }
      Tab(AppText.string("tab.automations"), systemImage: "flowchart", value: .automations) {
        AutomationsPage()
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
    .sheet(item: $ask) { request in
      AskSheet(draft: request.draft).environment(store)
    }
    .fullScreenCover(item: $camera) { entry in
      CameraScreen(entry: entry).environment(store)
    }
    .sheet(item: $run) { request in
      CommandRunSheet(request: request).environment(store)
    }
    .alert(store.failure ?? "", isPresented: failureShown) {
      Button(AppText.string("action.ok"), role: .cancel) {}
    }
    .onChange(of: scenePhase) { _, phase in
      // The keyboard may have reported itself, or changed an option, while Atd was away.
      if phase == .active { store.reload() }
    }
    .onOpenURL { routes.open($0) }
    // How the Lock Screen capture extension hands its photos over once the person unlocks.
    .onContinueUserActivity(NSUserActivityTypeLockedCameraCapture) { _ in
      routes.open(.lockedCapture)
    }
    .onChange(of: routes.pending, initial: true) { _, route in
      if let route { show(route) }
    }
    .onChange(of: CommandRunCenter.shared.pending, initial: true) { _, _ in
      if let request = CommandRunCenter.shared.take() {
        ask = nil
        camera = nil
        run = request
      }
    }
  }

  /// Picking 问 Atd opens the panel and leaves the current tab showing.
  private var selection: Binding<AppTab> {
    Binding(
      get: { tab },
      set: { picked in
        if picked == .ask { ask = AskRequest(draft: "") } else { tab = picked }
      })
  }

  private var failureShown: Binding<Bool> {
    Binding(get: { store.failure != nil }, set: { if !$0 { store.failure = nil } })
  }

  /// Shows a route. The root takes the routes it shows itself: a tab, 问 Atd and the camera. For a
  /// detail (a command, a mini app, an automation, the model connections) it selects the tab and
  /// leaves the route pending for that tab's page to take. A camera route while the camera is open
  /// is left to the camera, which switches to it instead of opening a second one.
  private func show(_ route: AtdRoute) {
    switch route {
    case .commands, .miniApps, .automations, .me:
      _ = routes.take { $0 }
      select(route)
    case .command, .miniApp, .automation, .models:
      select(route)
    case .ask(let text):
      _ = routes.take { $0 }
      camera = nil
      run = nil
      // An open panel keeps its conversation unless the route brings text to ask.
      if ask == nil || text?.isEmpty == false { ask = AskRequest(draft: text ?? "") }
    case .camera, .lockedCapture:
      guard camera == nil, let entry = routes.take(CameraEntry.init) else { return }
      ask = nil
      run = nil
      camera = entry
    }
  }

  /// Closes the panel or the camera and shows the tab `route` belongs to.
  private func select(_ route: AtdRoute) {
    guard let tab = AppTab(route) else { return }
    ask = nil
    camera = nil
    run = nil
    self.tab = tab
  }

  private static let mark = InkArt.markImage(side: 24)
}

enum AppTab: Hashable {
  case commands, miniApps, automations, me, ask

  /// The tab a tab or detail route belongs to; nil for 问 Atd and the camera, which open over the
  /// tabs.
  init?(_ route: AtdRoute) {
    switch route {
    case .commands, .command: self = .commands
    case .miniApps, .miniApp: self = .miniApps
    case .automations, .automation: self = .automations
    case .me, .models: self = .me
    case .ask, .camera, .lockedCapture: return nil
    }
  }
}

/// 问 Atd with `draft` in its field. Each request is a new panel.
private struct AskRequest: Identifiable {
  let id = UUID()
  let draft: String
}
