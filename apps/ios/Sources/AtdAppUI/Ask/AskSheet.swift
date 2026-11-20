import AtdAI
import PhotosUI
import SwiftUI

/// 问 Atd: ask anything, with photos from the library or the camera, and read the answer as it
/// streams in. The conversation lasts as long as the panel; 新对话 starts over.
struct AskSheet: View {
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var conversation = AskConversation()
  @State private var draft = ""
  @State private var trayOpen = false
  @State private var choosingPhotos = false
  @State private var chosen: [PhotosPickerItem] = []
  @State private var shooting = false
  @State private var addingModel = false
  @FocusState private var fieldFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
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
              AskTurnView(turn: turn) {
                conversation.retry(runner: store.runner) { store.noteFailure($0) }
              }
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
        }
      }
      .defaultScrollAnchor(.bottom, for: .sizeChanges)
      .scrollDismissesKeyboard(.interactively)
      dock
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    .onAppear { fieldFocused = store.hasModel }
    .onDisappear { conversation.stop() }
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

  private func attach(_ data: Data) async {
    guard conversation.photos.count < AskConversation.photoLimit,
      let photo = await PhotoEncoder.encode(data)
    else { return }
    conversation.photos.append(photo)
  }

  /// The field and its buttons at the bottom; until a model is added, the way to add one.
  @ViewBuilder private var dock: some View {
    if !store.hasModel {
      Button {
        addingModel = true
      } label: {
        Label(AppText.string("models.add"), systemImage: "plus")
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      .padding(16)
    } else {
      VStack(alignment: .leading, spacing: 10) {
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
            .focused($fieldFocused)
            .inkField(focused: fieldFocused)
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
          shooting = true
        } label: {
          Label(AppText.string("ask.camera"), systemImage: "camera")
        }
        .buttonStyle(InkButtonStyle())
      }
      Button {
        trayOpen = false
        choosingPhotos = true
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

extension AskSheet {
  /// 问 Atd with `draft` waiting in the field, for the `.ask(text:)` route (随手问 from a control,
  /// a widget, Siri or Shortcuts). Nothing is sent until the person sends it.
  init(draft: String) {
    self.init()
    _draft = State(initialValue: draft)
  }
}
