import AtdAutomations
import AtdInk
import AtdModel
import SwiftUI

/// The 自动化 tab: each automation's trigger and what it runs, with its state in the trailing
/// control: 去设置 until Shortcuts first ran it, then the switch that decides whether Atd acts. A
/// row, or an `atd://automation/<id>` link such as a Live Activity's tap, opens the automation.
struct AutomationsPage: View {
  @State private var model = AutomationsModel.live()
  @State private var opened: OpenedAutomation?
  @State private var setup: OpenedAutomation?
  /// 新建自动化 while it is open.
  @State private var creating: NewAutomation?
  /// The automation just added, whose setup opens once the new sheet is gone.
  @State private var added: Automation?
  /// An automation just added, marked for a moment so the eye finds it.
  @State private var fresh: String?
  @Environment(\.scenePhase) private var scenePhase
  private let routes = RouteCenter.shared

  var body: some View {
    ScrollViewReader { scroller in
      InkPage(
        title: AppText.string("tab.automations"), art: .automations,
        add: InkAction(label: AutomationText.string("automations.new")) {
          creating = NewAutomation()
        }
      ) {
        InkList(inset: 74) {
          ForEach(model.book.automations) { automation in
            AutomationRow(
              automation: automation, run: model.latestRun(of: automation.id),
              fresh: fresh == automation.id,
              isEnabled: Binding(
                get: { automation.isEnabled }, set: { model.setEnabled(automation.id, $0) }),
              open: { opened = OpenedAutomation(id: automation.id) },
              setUp: { setup = OpenedAutomation(id: automation.id) }
            )
            // The scroll target is a view inside the row: InkList re-emits its rows to put
            // dividers between them, and an id on the row itself does not reach the scroller.
            .background { Color.clear.id(automation.id) }
          }
        }
        SectionFooter(AutomationText.string("automations.footer"))
      }
      .onChange(of: fresh) { _, id in
        guard let id else { return }
        withAnimation { scroller.scrollTo(id, anchor: .center) }
      }
    }
    .onChange(of: routes.pending, initial: true) {
      guard let id = routes.take({ if case .automation(let id) = $0 { id } else { nil } }),
        model.automation(id) != nil
      else { return }
      setup = nil
      creating = nil
      opened = OpenedAutomation(id: id, fromLink: true)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { model.becameActive() }
    }
    .sheet(item: $opened) { opened in
      AutomationDetailSheet(id: opened.id, composesOnOpen: opened.fromLink)
        .environment(model)
    }
    .sheet(item: $setup) { setup in
      if let automation = model.automation(setup.id) {
        SetupSheet(automation: automation)
      }
    }
    .sheet(item: $creating, onDismiss: showAdded) { request in
      NewAutomationSheet(family: request.family) { automation in
        model.save(automation)
        added = automation
        creating = nil
      }
    }
    .alert(model.failure ?? "", isPresented: failureShown) {
      Button(AppText.string("action.ok"), role: .cancel) {}
    }
    #if DEBUG
      .task { openDebugSheet() }
    #endif
  }

  #if DEBUG
    /// For screenshots in the simulator, which cannot tap (A7): `-AtdDebug automations-sheet
    /// new [family]` opens 新建自动化, on that family's steps when one is named;
    /// `-AtdDebug automations-sheet setup <id>` the automation's setup, and `… detail <id>` the
    /// automation as a tap on its row does. `AutomationLaunch` selects this tab for the same
    /// argument.
    private func openDebugSheet() {
      let arguments = ProcessInfo.processInfo.arguments
      guard let flag = arguments.firstIndex(of: "-AtdDebug"), flag + 2 < arguments.count,
        arguments[flag + 1] == "automations-sheet"
      else { return }
      let value = flag + 3 < arguments.count ? arguments[flag + 3] : nil
      switch arguments[flag + 2] {
      case "new":
        creating = NewAutomation(family: value.flatMap(TriggerFamily.init(rawValue:)))
      case "setup":
        if let value { setup = OpenedAutomation(id: value) }
      case "detail":
        if let value { opened = OpenedAutomation(id: value) }
      default:
        break
      }
    }
  #endif

  /// Marks the automation just added and, as the prototype does, opens its setup: until it is
  /// set up in Shortcuts, nothing runs it.
  private func showAdded() {
    guard let automation = added else { return }
    added = nil
    fresh = automation.id
    AccessibilityNotification.Announcement(
      AutomationText.string("automations.added \(automation.trigger.title)")
    ).post()
    Task {
      try? await Task.sleep(for: .milliseconds(380))
      setup = OpenedAutomation(id: automation.id)
      try? await Task.sleep(for: .seconds(3))
      if fresh == automation.id { fresh = nil }
    }
  }

  private var failureShown: Binding<Bool> {
    Binding(get: { model.failure != nil }, set: { if !$0 { model.failure = nil } })
  }
}

private struct OpenedAutomation: Identifiable {
  let id: String
  /// Opened by a link (the Live Activity's tap) rather than the row.
  var fromLink = false
}

/// 新建自动化 as it opens: on the kinds of moment, or on one already picked.
private struct NewAutomation: Identifiable {
  let id = UUID()
  var family: TriggerFamily?
}
