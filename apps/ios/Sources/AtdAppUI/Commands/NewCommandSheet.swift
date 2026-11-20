import AtdAI
import AtdInk
import AtdModel
import SwiftUI
import UIKit

/// 新建指令: describe the command in one sentence and the default model drafts it, or start from
/// a blank form. Either way it is reviewed in the editor and saved with ✓.
struct NewCommandSheet: View {
  let onSaved: (Command) -> Void
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var step = Step.describe
  @State private var text = ""
  @State private var draft = CommandDraft.blank(tint: .purple)
  @State private var failure: ModelFailure?
  @State private var drafting: Task<Void, Never>?
  @State private var addingModel = false
  @FocusState private var describing: Bool

  private enum Step {
    case describe, drafting, review
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AppText.string("commands.new")) {
        leading
      } trailing: {
        if step == .review {
          Button {
            save()
          } label: {
            Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
          }
          .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
          .disabled(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .accessibilityLabel(AppText.string("action.save"))
        }
      }
      ScrollView {
        switch step {
        case .describe: describe
        case .drafting: progress
        case .review: CommandForm(command: $draft)
        }
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    // A drafted command is lost on dismissal, so only the buttons close the sheet then.
    .interactiveDismissDisabled(step == .review)
    .onAppear { describing = true }
    .onDisappear { drafting?.cancel() }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  @ViewBuilder private var leading: some View {
    if step == .describe {
      CloseButton { dismiss() }
    } else {
      Button {
        drafting?.cancel()
        step = .describe
      } label: {
        Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold))
      }
      .buttonStyle(InkButtonStyle(form: .round))
      .accessibilityLabel(AppText.string("new.back"))
    }
  }

  private var describe: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(AppText.string("new.describe"))
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
      TextField(AppText.string("new.example"), text: $text, axis: .vertical)
        .lineLimit(3...8)
        .lineSpacing(3)
        .focused($describing)
        .inkField(focused: describing)
        .accessibilityLabel(AppText.string("new.describe"))
      if let failure {
        Text(failure.message)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if store.hasModel {
        Button(action: generate) {
          Label(AppText.string("new.generate"), systemImage: "wand.and.sparkles")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      } else {
        Button {
          addingModel = true
        } label: {
          Label(AppText.string("models.add"), systemImage: "plus")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      }
      Button(AppText.string("new.blank")) {
        let id = UUID().uuidString
        let tints = CommandTint.allCases.filter { $0 != .gray }
        draft = CommandDraft.blank(id: id, tint: tints[inkSeed(id) % tints.count])
        step = .review
      }
      .font(.body.weight(.medium))
      .foregroundStyle(.primary)
      .frame(maxWidth: .infinity, minHeight: 44)
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
  }

  private var progress: some View {
    HStack(spacing: 12) {
      ProgressView()
      Text(AppText.string("new.drafting"))
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
    .padding(.horizontal, 20)
    .padding(.top, 8)
    .accessibilityElement(children: .combine)
  }

  private func generate() {
    let description = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !description.isEmpty else { return }
    describing = false
    failure = nil
    step = .drafting
    let runner = store.runner
    drafting = Task {
      var answer = ""
      do {
        for try await delta in runner.stream(CommandDraft.request(description), choice: .appDefault)
        {
          answer += delta
        }
        guard !Task.isCancelled else { return }
        guard var command = CommandDraft.command(from: answer) else {
          failure = .unreadable(detail: nil)
          step = .describe
          return
        }
        if UIImage(systemName: command.symbol) == nil { command.symbol = "sparkles" }
        draft = command
        step = .review
      } catch let error as ModelFailure {
        failure = error
        store.noteFailure(error)
        step = .describe
      } catch {
        // Went back to the description.
      }
    }
  }

  private func save() {
    var command = draft
    command.name = command.name.trimmingCharacters(in: .whitespacesAndNewlines)
    store.save(command)
    onSaved(command)
  }
}
