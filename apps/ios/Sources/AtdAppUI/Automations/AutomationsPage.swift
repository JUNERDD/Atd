import AtdModel
import SwiftUI

/// The 自动化 tab.
///
/// Stub (F0a): the page's head, and a placeholder for the automation an `.automation(id:)` route
/// names, which the page takes from `RouteCenter` (the root only selects the tab). WS-E replaces
/// it (prototype `auto.js`).
struct AutomationsPage: View {
  @State private var opened: OpenedAutomation?
  private let routes = RouteCenter.shared

  var body: some View {
    InkPage(title: AppText.string("tab.automations"), art: .automations) {
      EmptyView()
    }
    .onChange(of: routes.pending, initial: true) {
      if let id = routes.take({ if case .automation(let id) = $0 { id } else { nil } }) {
        opened = OpenedAutomation(id: id)
      }
    }
    .sheet(item: $opened) { automation in
      AutomationPlaceholder(id: automation.id)
    }
  }
}

private struct OpenedAutomation: Identifiable {
  let id: String
}

private struct AutomationPlaceholder: View {
  let id: String
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AppText.string("tab.automations")) {
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
