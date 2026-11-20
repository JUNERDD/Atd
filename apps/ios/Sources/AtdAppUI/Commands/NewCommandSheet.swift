import AtdModel
import SwiftUI

/// 新建指令: describe the command in one sentence and the default model drafts it, or start from
/// a blank form. Either way it is reviewed in the editor and saved with ✓.
struct NewCommandSheet: View {
  let onSaved: (Command) -> Void
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var flow = CommandDraftFlow()

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: AppText.string("commands.new")) {
        if flow.step == .describe {
          CloseButton { dismiss() }
        } else {
          BackButton(label: AppText.string("new.back")) { flow.back() }
        }
      } trailing: {
        DraftSaveButton(flow: flow) {
          let command = flow.finished
          if store.add(command) { onSaved(command) }
        }
      }
      ScrollView {
        CommandDraftBody(flow: flow, offersBlank: true)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    // A drafted command is lost on dismissal, so only the buttons close the sheet then.
    .interactiveDismissDisabled(flow.step == .review)
    .onDisappear { flow.cancel() }
  }
}
