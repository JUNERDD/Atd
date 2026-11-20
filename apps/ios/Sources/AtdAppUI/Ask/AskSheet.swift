import AtdAI
import AtdModel
import PhotosUI
import SwiftUI

/// 问 Atd: ask anything, with photos from the library or the camera, and read the answer as it
/// streams in. The conversation lasts as long as the panel; 新对话 starts over. 存为指令 turns an
/// answer into a command in the same panel and comes back to the answer, which then names it.
struct AskSheet: View {
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var conversation: AskConversation
  @State private var draft = ""
  @State private var trayOpen = false
  @State private var choosingPhotos = false
  @State private var chosen: [PhotosPickerItem] = []
  @State private var shooting = false
  @State private var addingModel = false
  /// The answer being made into a command; while there is one, the panel shows its draft.
  @State private var saving: SavingAnswer?
  /// The turn to bring back into view when the conversation shows again.
  @State private var reveal: UUID?
  @FocusState private var fieldFocused: Bool

  /// Opens 问 Atd, about `context` when there is one: its chip waits above the field, and the first
  /// question takes its text in the prompt and its photo as an attachment.
  init(context: AskContext? = nil) {
    _conversation = State(initialValue: AskConversation(context: context))
  }

  var body: some View {
    VStack(spacing: 0) {
      if let saving {
        SavingHeader(flow: saving.flow, leave: leaveSaving) { finishSaving(saving) }
        ScrollView {
          CommandDraftBody(flow: saving.flow)
        }
        .scrollDismissesKeyboard(.interactively)
      } else {
        header
        transcript
        AskDock(
          conversation: conversation, draft: $draft, trayOpen: $trayOpen,
          fieldFocused: $fieldFocused, choosePhotos: { choosingPhotos = true },
          shoot: { shooting = true }, addModel: { addingModel = true })
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    // A drafted command is lost on dismissal, so only the buttons leave it.
    .interactiveDismissDisabled(saving?.flow.step == .review)
    .onAppear { fieldFocused = store.hasModel }
    .onDisappear {
      conversation.stop()
      saving?.flow.cancel()
    }
    .photosPicker(
      isPresented: $choosingPhotos, selection: $chosen,
      maxSelectionCount: AskConversation.photoLimit - conversation.photos.count,
      matching: .images
    )
    .onChange(of: chosen) { _, items in
      guard !items.isEmpty else { return }
      chosen = []
      Task {
        for item in items {
          guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
          await attach(data)
        }
      }
    }
    .fullScreenCover(isPresented: $shooting) {
      CameraPicker { data in
        shooting = false
        if let data { Task { await attach(data) } }
      }
      .ignoresSafeArea()
    }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  private var header: some View {
    SheetHeader(title: AppText.string("ask.title")) {
      CloseButton { dismiss() }
    } trailing: {
      if !conversation.turns.isEmpty {
        Button {
          conversation.reset()
          fieldFocused = true
        } label: {
          Image(systemName: "square.and.pencil").font(.system(size: 17, weight: .semibold))
        }
        .buttonStyle(InkButtonStyle(form: .round))
        .accessibilityLabel(AppText.string("ask.new"))
      }
    }
  }

  private var transcript: some View {
    ScrollViewReader { scroller in
      ScrollView {
        if conversation.turns.isEmpty {
          Text(AppText.string("ask.hello"))
            .font(.title2.bold())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 24)
        } else {
          LazyVStack(alignment: .leading, spacing: 28) {
            ForEach(conversation.turns) { turn in
              AskTurnView(
                turn: turn,
                retry: { conversation.retry(runner: store.runner) { store.noteFailure($0) } },
                save: { startSaving(turn) },
                showSaved: { show(turn.saved) }
              )
              .id(turn.id)
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
        }
      }
      .defaultScrollAnchor(.bottom, for: .initialOffset)
      .defaultScrollAnchor(.bottom, for: .sizeChanges)
      .scrollDismissesKeyboard(.interactively)
      .onAppear {
        // Back from 存为指令: the answer it started from, with what became of it, is in view.
        guard let turn = reveal else { return }
        reveal = nil
        scroller.scrollTo(turn, anchor: .bottom)
      }
    }
  }

  private func attach(_ data: Data) async {
    guard conversation.photos.count < AskConversation.photoLimit,
      let photo = await PhotoEncoder.encode(data)
    else { return }
    conversation.photos.append(photo)
  }

  /// 存为指令: the question becomes the sentence to draft from, and the answer goes with it as an
  /// example of the result. A question not yet sent stays in the field.
  private func startSaving(_ turn: AskConversation.Turn) {
    fieldFocused = false
    trayOpen = false
    saving = SavingAnswer(
      turn: turn.id, flow: CommandDraftFlow(text: turn.question, example: turn.answer))
  }

  /// Back to the conversation without a command.
  private func leaveSaving() {
    guard let saving else { return }
    saving.flow.cancel()
    reveal = saving.turn
    self.saving = nil
  }

  /// ✓: saves the command and goes back to the answer, which now names it.
  private func finishSaving(_ saving: SavingAnswer) {
    let command = saving.flow.finished
    guard store.add(command) else { return }
    conversation.markSaved(saving.turn, as: command)
    reveal = saving.turn
    self.saving = nil
    AccessibilityNotification.Announcement(AppText.string("ask.saved \(command.displayName)"))
      .post()
  }

  /// 查看: closes the panel and points the command out on the 指令 tab.
  private func show(_ saved: AskConversation.SavedCommand?) {
    guard let saved else { return }
    CommandSpotlight.shared.show(saved.id)
    dismiss()
  }
}

/// An answer on its way to becoming a command.
private struct SavingAnswer {
  let turn: UUID
  let flow: CommandDraftFlow
}

/// The head of the panel while an answer is made into a command: ‹ goes back to the conversation
/// from the sentence and back to the sentence from the draft; ✓ saves.
private struct SavingHeader: View {
  let flow: CommandDraftFlow
  let leave: () -> Void
  let save: () -> Void

  var body: some View {
    SheetHeader(title: AppText.string("ask.save")) {
      if flow.step == .describe {
        BackButton(label: AppText.string("ask.backToChat"), action: leave)
      } else {
        BackButton(label: AppText.string("new.back")) { flow.back() }
      }
    } trailing: {
      DraftSaveButton(flow: flow, save: save)
    }
  }
}
