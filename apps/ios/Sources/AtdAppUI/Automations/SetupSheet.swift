import AtdAutomations
import AtdInk
import SwiftUI

/// 在快捷指令里启用: Atd cannot create personal automations, so this says how to create the one
/// that runs an automation, and opens Shortcuts. Nothing here marks it set up: Atd knows only
/// once Shortcuts runs it the first time.
struct SetupSheet: View {
  let automation: Automation
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AutomationText.string("setup.title")) {
        CloseButton { dismiss() }
      } trailing: {
        EmptyView()
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text(AutomationText.string("setup.lead"))
            .font(.subheadline)
            .foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
              HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(verbatim: "\(index + 1)")
                  .font(.subheadline.weight(.bold))
                  .frame(width: 26, height: 26)
                  .background(InkColor.chosen, in: Circle())
                  .accessibilityHidden(true)
                Text(step)
                  .frame(maxWidth: .infinity, alignment: .leading)
              }
              .accessibilityElement(children: .combine)
            }
          }
          Button {
            if let url = URL(string: "shortcuts://") { openURL(url) }
            dismiss()
          } label: {
            Text(AutomationText.string("setup.open"))
          }
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
          Text(AutomationText.string("setup.linked"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 20)
      }
    }
    .presentationDetents([.medium, .large])
    .presentationBackground(InkColor.paper)
  }

  /// Shortcuts' own steps, in its order: the trigger and 立即运行 on one page, then the action.
  private var steps: [String] {
    var steps = [
      AutomationText.string("setup.step.new"),
      AutomationText.string("setup.step.trigger \(automation.trigger.family.shortcutsName)"),
      AutomationText.string("setup.step.action \(automation.name)"),
    ]
    if automation.readsAloud { steps.append(AutomationText.string("setup.step.speak")) }
    return steps
  }
}
