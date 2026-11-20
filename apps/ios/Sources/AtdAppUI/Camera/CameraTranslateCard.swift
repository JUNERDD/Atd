import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// 翻译's card: what the photo shows and the language it was put into, then each item with the
/// number it has on the photo, its translation and price. 拷贝译文 copies them all; 问 Atd asks
/// about them with the photo.
struct CameraTranslateCard: View {
  let command: Command
  let translation: CameraTranslation
  /// The answer is still arriving.
  let streaming: Bool
  let photo: ModelImage?
  let ask: (CameraAskTopic) -> Void

  private var target: String {
    command.option(BuiltinCommands.OptionKey.language)?.value ?? ""
  }

  private var title: String {
    translation.title ?? CameraCopy.string("camera.translate.untitled")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      CameraCardHead(
        command: command, title: CameraCopy.string("camera.translate.lead \(title) \(target)"))
      InkList(inset: 34) {
        ForEach(translation.items) { item in
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            CameraBadge(number: item.id)
            Text(item.text).frame(maxWidth: .infinity, alignment: .leading)
            if let price = Self.price(item) {
              Text(price).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 10)
          .accessibilityElement(children: .combine)
        }
      }
      if streaming {
        ProgressView().frame(maxWidth: .infinity)
      } else {
        HStack(spacing: 10) {
          CameraCopyButton(
            title: CameraCopy.string("camera.translate.copy"),
            copiedTitle: CameraCopy.string("camera.translate.copied"), text: { copyText },
            kind: .filled)
          Button(CameraCopy.string("camera.ask")) {
            ask(
              CameraAskTopic(
                title: CameraCopy.string("camera.translate.asked \(title)"), text: copyText,
                photo: photo, symbol: command.symbol))
          }
          .buttonStyle(InkButtonStyle())
        }
      }
    }
  }

  /// ¥980 ≈46 元.
  private static func price(_ item: CameraTranslation.Item) -> String? {
    let parts = [item.price, item.approx].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
  }

  /// The title, then one numbered line per item.
  private var copyText: String {
    let lines = translation.items.map { item in
      ["\(item.id). \(item.text)", Self.price(item)].compactMap { $0 }.joined(separator: "  ")
    }
    return ([title] + lines).joined(separator: "\n")
  }
}

/// A card for any other command the camera runs: the command's text answer (or a briefing's
/// sentences), 拷贝 and 问 Atd.
struct CameraTextCard: View {
  let command: Command
  let card: CardResult
  let photo: ModelImage?
  let ask: (CameraAskTopic) -> Void

  private var text: String {
    switch card {
    case .text(let card): card.text
    case .briefing(let briefing): briefing.sentences.joined(separator: "\n")
    case .event(let draft): draft.title
    case .expense(let draft): draft.merchant ?? ""
    case .notes(let notes): notes.title ?? ""
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      CameraCardHead(command: command, title: command.name)
      Text(text)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 10) {
        CameraCopyButton(
          title: CameraCopy.string("camera.copy"), copiedTitle: CameraCopy.string("camera.copied"),
          text: { text }, kind: .filled)
        Button(CameraCopy.string("camera.ask")) {
          ask(CameraAskTopic(title: command.name, text: text, photo: photo, symbol: command.symbol))
        }
        .buttonStyle(InkButtonStyle())
      }
    }
  }
}
