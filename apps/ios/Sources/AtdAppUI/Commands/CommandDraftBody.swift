import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// What a sheet that drafts a command shows at each step: the sentence with 生成 (添加模型 until a
/// model is added), the line that waits for the draft, then the editor. 新建指令 and 存为指令 both
/// use it, each in its own sheet with its own header.
struct CommandDraftBody: View {
  @Bindable var flow: CommandDraftFlow
  /// 新建指令 also offers a blank form; 存为指令 always drafts from the exchange.
  var offersBlank = false
  @Environment(AppStore.self) private var store
  @State private var addingModel = false
  @FocusState private var describing: Bool

  var body: some View {
    Group {
      switch flow.step {
      case .describe: describe
      case .drafting: progress
      case .review: CommandForm(command: $flow.draft)
      }
    }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  private var describe: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(AppText.string("new.describe"))
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
      TextField(AppText.string("new.example"), text: $flow.text, axis: .vertical)
        .lineLimit(3...8)
        .lineSpacing(3)
        .focused($describing)
        .inkField(focused: describing)
        .accessibilityLabel(AppText.string("new.describe"))
      if let failure = flow.failure {
        Text(failure.message)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if store.hasModel {
        Button {
          describing = false
          flow.generate(runner: store.runner) { store.noteFailure($0) }
        } label: {
          Label(AppText.string("new.generate"), systemImage: "wand.and.sparkles")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .disabled(flow.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      } else {
        Button {
          addingModel = true
        } label: {
          Label(AppText.string("models.add"), systemImage: "plus")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      }
      if offersBlank {
        Button(AppText.string("new.blank")) {
          flow.startBlank()
        }
        .font(.body.weight(.medium))
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity, minHeight: 44)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    // An empty sentence is there to be typed; one carried over from 问 Atd is ready to draft.
    .onAppear { describing = flow.text.isEmpty }
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
}

/// The ✓ of a sheet that drafts a command, shown once there is a draft to save.
struct DraftSaveButton: View {
  let flow: CommandDraftFlow
  let save: () -> Void

  var body: some View {
    if flow.step == .review {
      Button(action: save) {
        Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
      .disabled(!flow.canSave)
      .accessibilityLabel(AppText.string("action.save"))
    }
  }
}
