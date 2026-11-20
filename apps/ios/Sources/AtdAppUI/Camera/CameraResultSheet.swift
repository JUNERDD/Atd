import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// The paper sheet under the marked photo: 重拍 and the command's name at the top, then the
/// answer as its card with the card's one primary action, or why there is none (重试, or 添加模型
/// when no model is configured). Swiping it down retakes too.
struct CameraResultSheet: View {
  let flow: CameraFlow
  let retake: () -> Void
  /// Runs the same photo again, with the command as the library has it now.
  let retry: () -> Void
  @Environment(AppStore.self) private var store
  @State private var asking: CameraAskTopic?
  @State private var addingModel = false

  /// The detent the photo is fitted above.
  static let height: CGFloat = 378

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: flow.command?.name ?? "") {
        Button(CameraCopy.string("camera.retake"), action: retake)
          .buttonStyle(InkButtonStyle())
      } trailing: {
        EmptyView()
      }
      ScrollView {
        content
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
      }
    }
    .presentationDetents([.height(Self.height), .large])
    .presentationBackground(InkColor.paper)
    .presentationBackgroundInteraction(.enabled(upThrough: .height(Self.height)))
    .sheet(item: $asking) { topic in
      CameraAsk.sheet(about: topic).environment(store)
    }
    .sheet(isPresented: $addingModel, onDismiss: modelAdded) {
      ConnectionEditor(connection: nil).environment(store)
    }
  }

  /// Back from adding a model: the same photo runs again if one was added.
  private func modelAdded() {
    if store.hasModel { retry() }
  }

  @ViewBuilder private var content: some View {
    if let failure = flow.failure {
      failed(failure)
    } else if let command = flow.command, let answer = flow.answer {
      let ask = { (topic: CameraAskTopic) in asking = topic }
      switch answer {
      case .translation(let translation):
        CameraTranslateCard(
          command: command, translation: translation, streaming: flow.phase == .reading,
          photo: flow.modelImage, ask: ask)
      case .card(.expense(let draft), let marks):
        CameraExpenseCard(command: command, draft: draft, marks: marks)
      case .card(.event(let draft), let marks):
        CameraEventCard(command: command, draft: draft, marks: marks)
      case .card(.notes(let notes), let marks):
        CameraNotesCard(command: command, notes: notes, marks: marks)
      case .card(let card, _):
        CameraTextCard(command: command, card: card, photo: flow.modelImage, ask: ask)
      }
    } else {
      ProgressView().frame(maxWidth: .infinity, minHeight: 120)
    }
  }

  private func failed(_ failure: CameraFailure) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(failure.message)
        .font(.body)
        .frame(maxWidth: .infinity, alignment: .leading)
      if failure.needsModel {
        Button(AppText.string("models.add")) { addingModel = true }
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      } else if failure.canRetry {
        Button(CameraCopy.string("camera.retry"), action: retry)
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      }
    }
  }
}

/// A card's head: the command's sticker, a title and a line under it, each with the number of
/// its mark on the photo when it has one.
struct CameraCardHead: View {
  let command: Command
  let title: String
  var subtitle: String?
  var badge: Int?
  var subtitleBadge: Int?

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Sticker(symbol: command.symbol, tint: command.tint, seed: command.id)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          if let badge { CameraBadge(number: badge) }
          Text(title).font(.title3.bold())
        }
        if let subtitle {
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let subtitleBadge { CameraBadge(number: subtitleBadge) }
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
          }
        }
      }
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .combine)
  }
}

/// What an action did, on green highlighter, with 撤销 when it can be undone.
struct CameraDoneNote: View {
  let text: String
  var undo: (() -> Void)?

  var body: some View {
    HStack(spacing: 10) {
      Label(text, systemImage: "checkmark")
        .font(.subheadline.weight(.semibold))
      Spacer(minLength: 0)
      if let undo {
        Button(CameraCopy.string("camera.undo"), action: undo)
          .font(.subheadline.weight(.semibold))
          .frame(minHeight: 44)
      }
    }
    .padding(.horizontal, 14)
    .frame(minHeight: 48)
    .background { InkShape(corners: .block, wobble: 0.6, seed: 31).fill(InkColor.on) }
  }
}

/// An access problem: what is off, a way to copy the content instead and 去设置.
struct CameraDeniedNote: View {
  let text: String
  let copyTitle: String
  let copy: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(text).font(.subheadline.weight(.semibold))
      HStack(spacing: 10) {
        Button(copyTitle, action: copy).buttonStyle(InkButtonStyle())
        if let url = CameraActions.settingsURL {
          Link(CameraCopy.string("camera.settings"), destination: url)
            .buttonStyle(InkButtonStyle())
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A button that copies `text` and says so for a moment.
struct CameraCopyButton: View {
  let title: String
  let copiedTitle: String
  let text: () -> String
  var kind = InkButtonStyle.Kind.bordered
  var form = InkButtonStyle.Form.capsule
  @State private var copied = false

  var body: some View {
    Button {
      CameraActions.copy(text())
      copied = true
      Task {
        try? await Task.sleep(for: .seconds(2))
        copied = false
      }
    } label: {
      Label(copied ? copiedTitle : title, systemImage: copied ? "checkmark" : "doc.on.doc")
    }
    .buttonStyle(InkButtonStyle(kind: kind, form: form))
    .sensoryFeedback(.success, trigger: copied) { _, now in now }
  }
}
