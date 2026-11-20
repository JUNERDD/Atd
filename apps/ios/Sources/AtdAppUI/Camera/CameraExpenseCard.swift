import AtdAI
import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI

/// 记一笔's card: the merchant, when and how much, with the numbers of the boxes on the photo;
/// its category and the book it goes to. 记入「记账本」 records it (`LedgerBook`); once recorded
/// it can be undone, and 在记账本里看 opens the 记账本 mini app.
struct CameraExpenseCard: View {
  let command: Command
  let draft: ExpenseDraft
  let marks: [CameraMark]
  @Environment(AppStore.self) private var store
  @State private var recorded: Expense?
  @State private var problem: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      CameraCardHead(
        command: command, title: draft.merchant ?? draft.category.name, subtitle: subtitle,
        badge: number(.merchant), subtitleBadge: number(.time))
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if let total = number(.total) { CameraBadge(number: total) }
        Text(draft.amount, format: .currency(code: draft.currency))
          .font(.largeTitle.bold().monospacedDigit())
          .minimumScaleFactor(0.6)
          .lineLimit(1)
      }
      InkList {
        row(CameraCopy.string("camera.expense.category"), value: draft.category.name)
        row(command.option(BuiltinCommands.OptionKey.book)?.label ?? "", value: draft.book)
      }
      if let recorded {
        CameraDoneNote(text: CameraCopy.string("camera.expense.added")) {
          if CameraActions(store: store.store).unrecord(recorded) { self.recorded = nil }
        }
        Button {
          RouteCenter.shared.open(.miniApp(id: MiniAppBuiltins.ledgerID))
        } label: {
          Label(CameraCopy.string("camera.expense.view"), systemImage: "chevron.right")
            .labelStyle(TrailingIconLabelStyle())
        }
        .buttonStyle(InkButtonStyle())
      } else {
        Button(CameraCopy.string("camera.expense.add"), action: record)
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        if let problem {
          Text(problem).font(.footnote).foregroundStyle(InkColor.alert)
        }
      }
    }
    .sensoryFeedback(.success, trigger: recorded != nil) { _, now in now }
  }

  /// 今天 15:20 · <note>: the time first, next to its mark's number.
  private var subtitle: String {
    let time =
      Calendar.current.isDateInToday(draft.date)
      ? CameraCopy.string(
        "camera.expense.today \(draft.date.formatted(date: .omitted, time: .shortened))")
      : draft.date.formatted(date: .abbreviated, time: .shortened)
    return [time, draft.note].compactMap { $0 }.joined(separator: " · ")
  }

  private func number(_ field: CameraMarkField) -> Int? {
    CameraMarkName.number(of: field, in: marks)
  }

  private func row(_ label: String, value: String) -> some View {
    HStack {
      Text(label).foregroundStyle(.secondary)
      Spacer()
      Text(value)
    }
    .padding(.vertical, 12)
    .accessibilityElement(children: .combine)
  }

  private func record() {
    switch CameraActions(store: store.store).record(draft) {
    case .done(let expense):
      recorded = expense
      problem = nil
    case .denied:
      problem = CameraCopy.string("camera.saveFailed")
    case .failed(let message):
      problem = message
    }
  }
}

/// The title, then the icon after it, as a link that goes on reads.
struct TrailingIconLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.title
      configuration.icon.font(.footnote.weight(.semibold))
    }
  }
}
