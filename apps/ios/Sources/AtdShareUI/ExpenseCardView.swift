import AtdActions
import AtdModel
import SwiftUI

/// 记一笔's card: the amount, where and when, its 类别 and 记到, and 记入「记账本」. It reads as
/// found unless the command previews its result, which makes it editable (A16).
struct ExpenseCardView: View {
  let run: ShareRun

  var body: some View {
    if let expense = run.expense {
      Form {
        Section {
          summary(expense)
        }
        Section {
          details(expense)
        } footer: {
          if let issue = run.issue { Text(issue.message) }
        }
      }
      .safeAreaBar(edge: .bottom) {
        ActionBar {
          PrimaryButton(
            title: String(localized: "expense.log", bundle: .module), symbol: "wallet.bifold",
            action: run.logExpense
          )
          .disabled(expense.amount <= 0 || run.services.ledger == nil)
        }
      }
    }
  }

  @ViewBuilder private func summary(_ expense: ExpenseDraft) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(expense.amount, format: .currency(code: expense.currency))
        .font(.largeTitle.weight(.bold))
        .monospacedDigit()
      if let merchant = expense.merchant {
        Text(merchant).font(.headline)
      }
      Text(
        [expense.note, expense.date.formatted(date: .abbreviated, time: .shortened)]
          .compactMap(\.self).joined(separator: " · ")
      )
      .font(.subheadline)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private func details(_ expense: ExpenseDraft) -> some View {
    let book = run.command.option(BuiltinCommands.OptionKey.book)
    if run.isEditable {
      LabeledContent(String(localized: "expense.amount", bundle: .module)) {
        TextField(
          String(localized: "expense.amount", bundle: .module),
          value: Binding(get: { expense.amount }, set: { run.expense?.amount = $0 }),
          format: .number
        )
        .keyboardType(.decimalPad)
        .multilineTextAlignment(.trailing)
      }
      LabeledContent(String(localized: "expense.merchant", bundle: .module)) {
        TextField(
          String(localized: "expense.merchant", bundle: .module),
          text: Binding(
            get: { expense.merchant ?? "" },
            set: { run.expense?.merchant = $0.trimmed.isEmpty ? nil : $0 })
        )
        .multilineTextAlignment(.trailing)
      }
      Picker(
        String(localized: "expense.category", bundle: .module),
        selection: Binding(get: { expense.category }, set: { run.expense?.category = $0 })
      ) {
        ForEach(ExpenseCategory.allCases, id: \.self) { category in
          Label(category.name, systemImage: category.symbol).tag(category)
        }
      }
      if let book {
        Picker(
          book.label, selection: Binding(get: { expense.book }, set: { run.setBook($0) })
        ) {
          ForEach(book.choices, id: \.self) { Text($0).tag($0) }
        }
      }
    } else {
      LabeledContent(String(localized: "expense.category", bundle: .module)) {
        Label(expense.category.name, systemImage: expense.category.symbol)
          .foregroundStyle(.secondary)
      }
      LabeledContent(book?.label ?? "", value: expense.book)
    }
  }
}
