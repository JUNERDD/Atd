import AtdAutomations
import AtdInk
import AtdModel
import SwiftUI

/// An automation in a sheet: what triggers it, its steps, its latest run, and 试一次. A run
/// waiting for its message is answered here too; opened from the Live Activity's tap
/// (`composesOnOpen`), the compose sheet comes up at once, as the prototype's 发送 does.
struct AutomationDetailSheet: View {
  let id: String
  let composesOnOpen: Bool
  @Environment(AutomationsModel.self) private var model
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var settingUp = false
  @State private var editing: EditedStep?
  @State private var confirmingDelete = false
  /// The message in the compose sheet, and the run waiting for it.
  @State private var composing: MessageDraft?
  @State private var composingRun: AutomationRun?
  @State private var cannotSend = false

  var body: some View {
    VStack(spacing: 0) {
      if let automation = model.automation(id) {
        SheetHeader(title: automation.trigger.title, showsTitle: false) {
          CloseButton { dismiss() }
        } trailing: {
          EmptyView()
        }
        ScrollView {
          content(automation)
        }
      }
    }
    .background(MessageComposer(draft: $composing, onFinish: composed))
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    .sheet(isPresented: $settingUp) {
      if let automation = model.automation(id) { SetupSheet(automation: automation) }
    }
    .sheet(item: $editing) { edited in
      MessageStepEditor(automationID: id, index: edited.index).environment(model)
    }
    .alert(AutomationText.string("message.cannotSend"), isPresented: $cannotSend) {
      Button(AppText.string("action.ok"), role: .cancel) {}
    }
    .task {
      // Once the sheet is up, so the compose sheet can come over it.
      guard composesOnOpen, let run = model.latestRun(of: id), case .awaiting = run.phase else {
        return
      }
      try? await Task.sleep(for: .milliseconds(600))
      send(run)
    }
  }

  @ViewBuilder private func content(_ automation: Automation) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      head(automation)
      state(automation)
      SectionHeader(AutomationText.string("detail.steps"))
      InkList(inset: 62) {
        ForEach(Array(automation.steps.enumerated()), id: \.offset) { index, step in
          stepRow(step, at: index)
        }
      }
      if automation.readsAloud { SectionFooter(AutomationText.string("detail.readsAloud")) }
      if automation.focusLabel != nil {
        FocusSessions(sessions: model.sessions(of: id)) { model.endFocus($0) }
      } else if let run = model.latestRun(of: id) {
        RunSection(run: run, send: { send(run) }, skip: { model.skip(run) }) {
          model.resume(run)
        }
      }
      tryButton(automation)
      footer(automation)
    }
    .padding(.bottom, 24)
  }

  private func head(_ automation: Automation) -> some View {
    HStack(spacing: 14) {
      Sticker(symbol: automation.symbol, tint: automation.tint, seed: automation.id, size: 52)
      VStack(alignment: .leading, spacing: 2) {
        Text(automation.trigger.title)
          .font(.title2.bold())
          .accessibilityAddTraits(.isHeader)
        Text(AutomationText.string("row.runs \(automation.name)"))
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 8)
  }

  /// The switch once Shortcuts ran it; until then, that it is not set up, and 去设置.
  @ViewBuilder private func state(_ automation: Automation) -> some View {
    if automation.isLinked {
      Toggle(
        isOn: Binding(get: { automation.isEnabled }, set: { model.setEnabled(id, $0) })
      ) {
        Text(AutomationText.string("detail.switch"))
      }
      .toggleStyle(InkToggleStyle())
      .padding(.horizontal, 20)
      .padding(.top, 14)
    } else {
      HStack {
        Text(AutomationText.string("detail.notLinked"))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button(AutomationText.string("row.setUp")) { settingUp = true }
          .buttonStyle(InkButtonStyle())
      }
      .padding(.horizontal, 20)
      .padding(.top, 14)
    }
  }

  /// A step's row; a message's opens its editor, where its recipient is picked.
  @ViewBuilder private func stepRow(_ step: AutomationStep, at index: Int) -> some View {
    let row = SettingsRow(
      symbol: step.symbol(commands: store.library), title: step.title(commands: store.library),
      chevron: step.needsApproval)
    if step.needsApproval {
      Button {
        editing = EditedStep(index: index)
      } label: {
        row
      }
      .buttonStyle(RowButtonStyle())
    } else {
      row
    }
  }

  @ViewBuilder private func tryButton(_ automation: Automation) -> some View {
    let title: String =
      if automation.focusLabel == nil {
        AutomationText.string("detail.try")
      } else if model.sessions(of: id).contains(where: \.isOpen) {
        AutomationText.string("detail.focus.end")
      } else {
        AutomationText.string("detail.focus.start")
      }
    Button(title) { model.tryOut(automation) }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      .disabled(model.latestRun(of: id)?.isLive == true)
      .padding(.horizontal, 16)
      .padding(.top, 24)
  }

  /// What else ends an automation: deleting it in Atd leaves the one in Shortcuts, and a
  /// built-in, which Atd keeps, ends only there.
  @ViewBuilder private func footer(_ automation: Automation) -> some View {
    if automation.isBuiltin {
      SectionFooter(AutomationText.string("detail.footer.builtin"))
    } else {
      SectionFooter(AutomationText.string("detail.footer"))
      Button(AutomationText.string("detail.delete"), role: .destructive) {
        confirmingDelete = true
      }
      .frame(maxWidth: .infinity, minHeight: 44)
      .padding(.top, 20)
      .confirmationDialog(
        AutomationText.string("detail.delete.confirm \(automation.trigger.title)"),
        isPresented: $confirmingDelete, titleVisibility: .visible
      ) {
        Button(AutomationText.string("detail.delete"), role: .destructive) {
          dismiss()
          model.remove(automation.id)
        }
      }
    }
  }

  /// 发送: the compose sheet with the run's message, or, where this iPhone cannot send one, the
  /// step passed on with a note.
  private func send(_ run: AutomationRun) {
    guard case .awaiting(let step) = run.phase, case .message(let draft) = run.plan[step] else {
      return
    }
    guard MessageComposer.canSend else {
      model.finishMessage(run, result: .unavailable)
      cannotSend = true
      return
    }
    composingRun = run
    composing = draft
  }

  private func composed(_ result: MessageResult) {
    guard let run = composingRun else { return }
    composingRun = nil
    model.finishMessage(run, result: result)
  }
}

private struct EditedStep: Identifiable {
  let index: Int
  var id: Int { index }
}
