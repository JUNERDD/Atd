import AtdAI
import AtdInk
import SwiftUI

/// What 问 Atd is opened about, such as a result the camera made. Its title names it on a chip
/// above the field; its text and photo go with the conversation's first question (the text in the
/// prompt, the photo attached) and stay in every request after it, like an earlier exchange.
struct AskContext {
  /// A short name for the chip, such as 居酒屋菜单 · 已翻译.
  var title: String
  /// The text the questions are about, such as a translation.
  var text: String?
  /// The photo the questions are about, already sized for a model.
  var photo: ModelImage?
  /// The SF Symbol on the chip when there is no photo to show.
  var symbol = "doc.text"

  /// The photo, as a request attaches it.
  var images: [ModelImage] { photo.map { [$0] } ?? [] }

  /// A question as the model reads it: under the context's title and text.
  func framing(_ question: String) -> String {
    var lines = [AppText.string("ask.context.prompt \(title)")]
    if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
      lines.append(text)
    }
    return (lines + ["", question]).joined(separator: "\n")
  }
}

/// The context on a chip: above the field with ✕ until the first question, then above that
/// question without it.
struct AskContextChip: View {
  let context: AskContext
  /// Leaves the context out of the conversation; nil once it has been sent.
  var remove: (() -> Void)?
  @Environment(\.dynamicTypeSize) private var typeSize
  // The photo and ✕ grow with the title, up to the size of a hit area.
  @ScaledMetric(relativeTo: .footnote) private var scaledPhoto: CGFloat = 22
  @ScaledMetric(relativeTo: .caption) private var scaledRemove: CGFloat = 28

  var body: some View {
    HStack(spacing: 6) {
      HStack(spacing: 6) {
        if let photo = context.photo {
          PhotoThumbnail(photo: photo, side: min(scaledPhoto, 44))
        } else {
          Image(systemName: context.symbol).imageScale(.small)
        }
        Text(context.title)
          .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
      }
      .padding(.vertical, 6)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(AppText.string("ask.context \(context.title)"))
      if let remove {
        // Drawn inside the chip; the hit area reaches 44 points around it.
        let side = min(scaledRemove, 44)
        let reach = (44 - side) / 2
        Button(action: remove) {
          Image(systemName: "xmark")
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(-reach)
        .accessibilityLabel(AppText.string("ask.context.remove \(context.title)"))
      }
    }
    .font(.footnote.weight(.semibold))
    .padding(.leading, 10)
    .padding(.trailing, remove == nil ? 12 : 2)
    .frame(minHeight: 32)
    .background(InkShape(corners: .chip, seed: 7).fill(InkColor.shade))
  }
}
