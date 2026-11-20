import AtdAutomations
import AtdInk
import SwiftUI

/// A message step's recipients and text. Changes are saved as they are made; a run already
/// going keeps the message it started with.
struct MessageStepEditor: View {
  let automationID: String
  let index: Int
  @Environment(AutomationsModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var picking = false
  @FocusState private var typing: Bool

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AutomationText.string("message.title")) {
        CloseButton { dismiss() }
      } trailing: {
        EmptyView()
      }
      if let draft {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            SectionHeader(AutomationText.string("message.recipients"))
            InkList {
              ForEach(draft.recipients, id: \.self) { recipient in
                recipientRow(recipient, in: draft)
              }
              Button {
                picking = true
              } label: {
                SettingsRow(
                  symbol: "person.crop.circle.badge.plus",
                  title: AutomationText.string("message.pick"), chevron: false)
              }
              .buttonStyle(RowButtonStyle())
            }
            if draft.recipients.isEmpty {
              SectionFooter(AutomationText.string("message.noRecipient"))
            }
            SectionHeader(AutomationText.string("message.body"))
            TextField(
              AutomationText.string("message.body"), text: text(of: draft), axis: .vertical
            )
            .lineLimit(1...4)
            .focused($typing)
            .inkField(focused: typing)
            .padding(.horizontal, 16)
            .padding(.top, 6)
            SectionFooter(AutomationText.string("message.footer"))
          }
        }
        .scrollDismissesKeyboard(.interactively)
      }
    }
    .background(ContactPicker(isPresented: $picking) { add($0) })
    .presentationDetents([.medium, .large])
    .presentationBackground(InkColor.paper)
  }

  private func recipientRow(_ recipient: MessageRecipient, in draft: MessageDraft) -> some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 1) {
        Text(recipient.name)
        if recipient.name != recipient.address {
          Text(recipient.address)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button {
        update { $0.recipients.removeAll { $0 == recipient } }
      } label: {
        Image(systemName: "minus.circle")
          .font(.title3)
          .foregroundStyle(InkColor.alert)
          .frame(width: 44, height: 44)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(AutomationText.string("message.remove \(recipient.name)"))
    }
    .padding(.leading, 20)
    .padding(.trailing, 8)
    .frame(minHeight: 52)
  }

  /// The step's message as stored now.
  private var draft: MessageDraft? {
    guard let automation = model.automation(automationID),
      automation.steps.indices.contains(index),
      case .message(let draft) = automation.steps[index]
    else { return nil }
    return draft
  }

  private func text(of draft: MessageDraft) -> Binding<String> {
    Binding(get: { self.draft?.body ?? draft.body }, set: { text in update { $0.body = text } })
  }

  private func add(_ recipient: MessageRecipient) {
    update { draft in
      if !draft.recipients.contains(where: { $0.address == recipient.address }) {
        draft.recipients.append(recipient)
      }
    }
  }

  private func update(_ change: (inout MessageDraft) -> Void) {
    guard var automation = model.automation(automationID), var draft else { return }
    change(&draft)
    automation.steps[index] = .message(draft: draft)
    model.save(automation)
  }
}
