import AtdAutomations
import AtdInk
import SwiftUI

/// An automation's row: its sticker, the trigger, what runs, and its state: 去设置 until
/// Shortcuts first ran it, then the switch. At the largest text sizes the state goes under the
/// words, which keep the row's width and wrap instead of being cut to a character.
struct AutomationRow: View {
  let automation: Automation
  let run: AutomationRun?
  let fresh: Bool
  @Binding var isEnabled: Bool
  let open: () -> Void
  let setUp: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let stacked = typeSize.isAccessibilitySize
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
      : AnyLayout(HStackLayout(spacing: 12))
    layout {
      Button(action: open) {
        HStack(spacing: 14) {
          Sticker(symbol: automation.symbol, tint: automation.tint, seed: automation.id)
          VStack(alignment: .leading, spacing: 1) {
            Text(automation.trigger.title)
              .font(.body.weight(.medium))
              .foregroundStyle(.primary)
            Text(automation.summary(latest: run))
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
          .lineLimit(stacked ? nil : 1)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 20)
        .padding(.trailing, stacked ? 20 : 0)
        .padding(.vertical, 10)
        .frame(minHeight: 64)
        .contentShape(Rectangle())
      }
      .buttonStyle(RowButtonStyle())
      .accessibilityElement(children: .combine)
      state
        // Under the words, where the list's dividers start.
        .padding(.leading, stacked ? 74 : 0)
        .padding(.trailing, 20)
        .padding(.bottom, stacked ? 12 : 0)
    }
    .background(InkColor.sticker(automation.tint).opacity(fresh ? 1 : 0))
    .animation(reduceMotion ? nil : .easeOut(duration: fresh ? 0.2 : 1.4), value: fresh)
  }

  @ViewBuilder private var state: some View {
    if automation.isLinked {
      Toggle(isOn: $isEnabled) { EmptyView() }
        .toggleStyle(InkToggleStyle())
        .fixedSize()
        .accessibilityLabel(automation.trigger.title)
    } else {
      Button(AutomationText.string("row.setUp"), action: setUp)
        .buttonStyle(InkButtonStyle())
        .accessibilityLabel(AutomationText.string("row.setUp.label \(automation.trigger.title)"))
    }
  }
}
