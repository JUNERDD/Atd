import AtdAI
import AtdInk
import SwiftUI
import UIKit

/// One question and its answer: the question on the right with its photos, the answer under it
/// as it streams in, then 拷贝 — or why there is no answer, with 重试 when trying again can help.
struct AskTurnView: View {
  let turn: AskConversation.Turn
  let retry: () -> Void
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      question
      switch turn.state {
      case .thinking:
        HStack(spacing: 8) {
          ProgressView()
          Text(AppText.string("ask.thinking")).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
      case .streaming, .done, .stopped:
        if !turn.answer.isEmpty {
          Text(Self.formatted(turn.answer))
            .lineSpacing(3)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if turn.state == .stopped {
          Text(AppText.string("ask.stopped"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        if turn.state == .done { copyButton }
      case .failed(let failure):
        Text(failure.message).foregroundStyle(.secondary)
        if failure.canRetry {
          Button(action: retry) {
            Label(AppText.string("ask.retry"), systemImage: "arrow.counterclockwise")
          }
          .buttonStyle(InkButtonStyle())
        }
      }
    }
  }

  private var question: some View {
    VStack(alignment: .trailing, spacing: 8) {
      if !turn.photos.isEmpty {
        HStack(spacing: 6) {
          ForEach(turn.photos.indices, id: \.self) { index in
            PhotoThumbnail(photo: turn.photos[index], side: 64)
          }
        }
      }
      Text(turn.question)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .inkCard(seed: turn.question.count)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.leading, 40)
  }

  private var copyButton: some View {
    Button {
      UIPasteboard.general.string = turn.answer
      copied = true
      Task {
        try? await Task.sleep(for: .seconds(1.5))
        copied = false
      }
    } label: {
      Label(
        copied ? AppText.string("ask.copied") : AppText.string("ask.copy"),
        systemImage: copied ? "checkmark" : "doc.on.doc")
    }
    .buttonStyle(InkButtonStyle())
  }

  /// The answer with its inline Markdown (bold, code, links) applied and its line breaks kept.
  private static func formatted(_ answer: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .inlineOnlyPreservingWhitespace)
    return (try? AttributedString(markdown: answer, options: options)) ?? AttributedString(answer)
  }
}

/// A photo attached to a question, cropped to a square with hand-rounded corners. It is decoded
/// once, not on every change of the answer streaming in below it.
struct PhotoThumbnail: View {
  let photo: ModelImage
  let side: CGFloat
  @State private var image: UIImage?

  var body: some View {
    ZStack {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        InkColor.shade
      }
    }
    .frame(width: side, height: side)
    .clipShape(InkShape(corners: .chip, wobble: 0))
    .accessibilityElement()
    .accessibilityLabel(AppText.string("ask.photo"))
    .onAppear {
      if image == nil { image = UIImage(data: photo.data) }
    }
  }
}
