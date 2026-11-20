import AtdModel
import SwiftUI

/// What the card's action did: 已添加到日历 with the event's title, or 已记入「记账本」 with the
/// amount, and 撤销 where it can be taken back (an event only with full calendar access).
struct DoneView: View {
  let run: ShareRun

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown = false

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 64))
        .symbolRenderingMode(.palette)
        .foregroundStyle(.white, .green)
        // The check bounces once as it shows, unless motion is reduced.
        .symbolEffect(.bounce, value: shown && !reduceMotion)
        .accessibilityHidden(true)
      Text(title)
        .font(.title2.weight(.bold))
        .padding(.top, 8)
      if let detail {
        Text(detail)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      if canUndo {
        Button {
          Task { await undo() }
        } label: {
          Text("done.undo", bundle: .module)
        }
        .buttonStyle(.bordered)
        .disabled(run.isBusy)
        .padding(.top, 12)
      }
    }
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // The card's ground, so the screen stays the same sheet.
    .background(Color(uiColor: .systemGroupedBackground))
    .sensoryFeedback(.success, trigger: shown) { _, now in now }
    .onAppear { shown = true }
  }

  private var title: String {
    run.logged != nil
      ? String(localized: "done.expense", bundle: .module)
      : String(localized: "done.event", bundle: .module)
  }

  private var detail: String? {
    if let logged = run.logged {
      let amount = logged.amount.formatted(.currency(code: logged.currency))
      return [amount, logged.merchant].compactMap(\.self).joined(separator: " · ")
    }
    return run.event?.title
  }

  private var canUndo: Bool {
    run.logged != nil || run.addition?.canRemove == true
  }

  private func undo() async {
    if run.logged != nil {
      run.undoExpense()
    } else {
      await run.undoEvent()
    }
  }
}
