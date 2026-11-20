import AtdInk
import AtdModel
import SwiftUI

/// 我的 › 常用短语: the phrases the keyboard inserts in one tap, even offline.
struct PhrasesPage: View {
  @Environment(AppStore.self) private var store
  @State private var editing: EditedPhrase?

  var body: some View {
    SubPage(title: AppText.string("me.phrases")) {
      Button {
        editing = EditedPhrase(phrase: Phrase(title: "", text: ""), isNew: true)
      } label: {
        Label(AppText.string("phrases.add"), systemImage: "plus")
      }
      .buttonStyle(InkButtonStyle())
      .padding(.horizontal, 20)
      .padding(.top, 12)
      .padding(.bottom, 8)
      InkList {
        ForEach(store.phrases.phrases) { phrase in
          Button {
            editing = EditedPhrase(phrase: phrase, isNew: false)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Text(phrase.title)
                .font(.body.weight(.medium))
                .foregroundStyle(.primary)
              Text(phrase.text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 53, alignment: .leading)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
          }
          .buttonStyle(RowButtonStyle())
        }
      }
    }
    .sheet(item: $editing) { edited in
      PhraseEditor(edited: edited)
    }
  }
}

private struct EditedPhrase: Identifiable {
  var phrase: Phrase
  var isNew: Bool
  var id: String { phrase.id }
}

/// A phrase's name, which the ✦ line finds it by, and its text.
private struct PhraseEditor: View {
  let edited: EditedPhrase
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var title: String
  @State private var text: String
  @State private var confirmingDelete = false
  @FocusState private var focus: Field?

  private enum Field {
    case title, text
  }

  init(edited: EditedPhrase) {
    self.edited = edited
    _title = State(initialValue: edited.phrase.title)
    _text = State(initialValue: edited.phrase.text)
  }

  private var trimmedText: String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(
        title: edited.isNew ? AppText.string("phrases.add") : AppText.string("phrases.edit")
      ) {
        CloseButton { dismiss() }
      } trailing: {
        Button(action: save) {
          Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
        .disabled(trimmedText.isEmpty)
        .accessibilityLabel(AppText.string("action.save"))
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          SectionHeader(AppText.string("phrases.title"))
          TextField(AppText.string("phrases.title.placeholder"), text: $title)
            .focused($focus, equals: .title)
            .inkField(focused: focus == .title)
            .padding(.horizontal, 16)
            .padding(.top, 6)
          SectionHeader(AppText.string("phrases.text"))
          TextField("", text: $text, axis: .vertical)
            .lineLimit(3...8)
            .focused($focus, equals: .text)
            .inkField(focused: focus == .text)
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .accessibilityLabel(AppText.string("phrases.text"))
          if !edited.isNew {
            Button(AppText.string("phrases.delete"), role: .destructive) {
              confirmingDelete = true
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.top, 28)
            .confirmationDialog(
              AppText.string("phrases.delete.confirm"), isPresented: $confirmingDelete,
              titleVisibility: .visible
            ) {
              Button(AppText.string("phrases.delete"), role: .destructive, action: delete)
            }
          }
        }
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    .onAppear { focus = edited.isNew ? .title : nil }
  }

  private func save() {
    var phrase = edited.phrase
    let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
    // An unnamed phrase is found by its first words.
    phrase.title = name.isEmpty ? String(trimmedText.prefix(6)) : name
    phrase.text = trimmedText
    var list = store.phrases.phrases
    if let index = list.firstIndex(where: { $0.id == phrase.id }) {
      list[index] = phrase
    } else {
      list.append(phrase)
    }
    store.setPhrases(list)
    dismiss()
  }

  private func delete() {
    store.setPhrases(store.phrases.phrases.filter { $0.id != edited.phrase.id })
    dismiss()
  }
}
