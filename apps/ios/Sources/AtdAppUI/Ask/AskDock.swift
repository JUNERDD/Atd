import AtdAI
import SwiftUI

/// The bottom of 问 Atd: the field between + and send (stop while an answer streams), the context
/// and photos waiting to go with the next question, and the tray that adds a photo. Until a model
/// is added, it is the way to add one.
struct AskDock: View {
  let conversation: AskConversation
  @Binding var draft: String
  @Binding var trayOpen: Bool
  let fieldFocused: FocusState<Bool>.Binding
  let choosePhotos: () -> Void
  let shoot: () -> Void
  let addModel: () -> Void
  @Environment(AppStore.self) private var store

  var body: some View {
    if !store.hasModel {
      Button(action: addModel) {
        Label(AppText.string("models.add"), systemImage: "plus")
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      .padding(16)
    } else {
      VStack(alignment: .leading, spacing: 10) {
        if conversation.turns.isEmpty, let context = conversation.context {
          AskContextChip(context: context) { conversation.leaveOutContext() }
            .padding(.top, 4)
        }
        if !conversation.photos.isEmpty { attachments }
        if trayOpen { tray }
        HStack(alignment: .bottom, spacing: 8) {
          Button {
            trayOpen.toggle()
          } label: {
            Image(systemName: "plus").font(.system(size: 17, weight: .semibold))
              .rotationEffect(.degrees(trayOpen ? 45 : 0))
          }
          .buttonStyle(InkButtonStyle(form: .round))
          .accessibilityLabel(AppText.string("ask.attach"))
          .disabled(conversation.photos.count >= AskConversation.photoLimit)
          TextField(AppText.string("ask.title"), text: $draft, axis: .vertical)
            .lineLimit(1...5)
            .focused(fieldFocused)
            .inkField(focused: fieldFocused.wrappedValue)
            .padding(.vertical, 2)
          sendButton
        }
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
      .padding(.bottom, 10)
    }
  }

  @ViewBuilder private var sendButton: some View {
    if conversation.isAnswering {
      Button {
        conversation.stop()
      } label: {
        Image(systemName: "stop.fill").font(.system(size: 13, weight: .bold))
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
      .accessibilityLabel(AppText.string("ask.stop"))
    } else {
      Button {
        conversation.ask(draft, runner: store.runner) { store.noteFailure($0) }
        draft = ""
        trayOpen = false
      } label: {
        Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
      .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .accessibilityLabel(AppText.string("ask.send"))
    }
  }

  /// 拍照 and 照片; 拍照 only where there is a camera.
  private var tray: some View {
    HStack(spacing: 8) {
      if CameraPicker.isAvailable {
        Button {
          trayOpen = false
          shoot()
        } label: {
          Label(AppText.string("ask.camera"), systemImage: "camera")
        }
        .buttonStyle(InkButtonStyle())
      }
      Button {
        trayOpen = false
        choosePhotos()
      } label: {
        Label(AppText.string("ask.photos"), systemImage: "photo")
      }
      .buttonStyle(InkButtonStyle())
    }
  }

  /// The photos waiting to be sent, each with a button that removes it.
  private var attachments: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 10) {
        ForEach(conversation.photos.indices, id: \.self) { index in
          PhotoThumbnail(photo: conversation.photos[index], side: 52)
            .overlay(alignment: .topTrailing) {
              Button {
                conversation.photos.remove(at: index)
              } label: {
                Image(systemName: "xmark.circle.fill")
                  .symbolRenderingMode(.palette)
                  .foregroundStyle(InkColor.paper, Color.primary)
                  .font(.system(size: 20))
                  .frame(width: 44, height: 44)
                  .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .offset(x: 16, y: -16)
              .accessibilityLabel(AppText.string("ask.removePhoto"))
            }
        }
      }
      .padding(.top, 10)
      .padding(.trailing, 16)
    }
    .scrollIndicators(.hidden)
  }
}
