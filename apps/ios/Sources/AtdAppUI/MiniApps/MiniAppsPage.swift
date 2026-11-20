import AtdInk
import AtdModel
import SwiftUI

/// The 小应用 tab.
///
/// Stub (F0a): the page's head, and a placeholder for the mini app a `.miniApp(id:)` route names,
/// which the page takes from `RouteCenter` (the root only selects the tab). WS-D replaces it
/// (prototype `apps.js`).
struct MiniAppsPage: View {
  @State private var opened: OpenedMiniApp?
  private let routes = RouteCenter.shared

  var body: some View {
    InkPage(title: AppText.string("tab.miniApps"), art: .apps) {
      EmptyView()
    }
    .onChange(of: routes.pending, initial: true) {
      if let id = routes.take({ if case .miniApp(let id) = $0 { id } else { nil } }) {
        opened = OpenedMiniApp(id: id)
      }
    }
    .sheet(item: $opened) { app in
      MiniAppPlaceholder(id: app.id)
    }
  }
}

private struct OpenedMiniApp: Identifiable {
  let id: String
}

private struct MiniAppPlaceholder: View {
  let id: String
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AppText.string("tab.miniApps")) {
        CloseButton { dismiss() }
      } trailing: {
        EmptyView()
      }
      Text(verbatim: id)
        .font(.title2.bold())
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .presentationBackground(InkColor.paper)
  }
}
