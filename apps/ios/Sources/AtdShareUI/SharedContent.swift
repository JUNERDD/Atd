import AtdAI
import Foundation
import UIKit

/// What another app shared with Atd: some text, a web page or one image. Atd sends it to a model
/// only when the person runs a command on it, and then only this.
nonisolated enum SharedContent: Sendable, Equatable {
  case text(String)
  case page(SharedPage)
  case image(SharedImage)

  /// The most text a command sends, in characters; a longer page or message is cut off here.
  static let textLimit = 12_000

  /// The text a command works on: the text itself, or a page's title, address and text.
  var text: String {
    switch self {
    case .text(let text): text
    case .page(let page): page.modelText
    case .image: ""
    }
  }

  var images: [ModelImage] {
    if case .image(let image) = self { [image.image] } else { [] }
  }

  /// What a card command reads.
  var cardInput: CardInput {
    CardInput(text: text, images: images)
  }

  /// The text the suggestion looks for dates in; nil for an image, and for a link whose
  /// page is read only when a command runs.
  var readableText: String? {
    switch self {
    case .text(let text): text
    case .page(let page):
      page.text.map { [page.title, $0].compactMap(\.self).joined(separator: "\n") }
    case .image: nil
    }
  }
}

/// A web page: the one Safari shared with its text (`Share/SharePage.js`), or a link another app
/// shared, whose text is read when a command runs.
nonisolated struct SharedPage: Sendable, Equatable {
  var url: URL
  var title: String?
  /// What the person selected on the page, else its text; nil when only the link was shared.
  var text: String?

  init(url: URL, title: String?, text: String?) {
    self.url = url
    self.title = title?.oneLine
    self.text = text?.trimmed.capped
  }

  /// The page `Share/SharePage.js` read at `url`: what the person selected, when they did, stands
  /// for the whole page.
  init(url: URL, preprocessed results: [String: String]) {
    let selection = results["selection"]?.trimmed
    let text = selection?.isEmpty == false ? selection : results["text"]
    self.init(url: url, title: results["title"], text: text ?? "")
  }

  /// The site's name for a page without a title (dushu.example.cn).
  var host: String {
    url.host(percentEncoded: false) ?? url.absoluteString
  }

  /// Title, address and text, as a card command expects a page (`CardInput.text`).
  var modelText: String {
    [title, url.absoluteString, text].compactMap(\.self).filter { !$0.isEmpty }
      .joined(separator: "\n\n")
  }
}

/// One shared photo or screenshot, ready for a model.
nonisolated struct SharedImage: Sendable, Equatable {
  /// The name the sharing app gave it (IMG_0042), without the extension.
  var name: String?
  /// At most `ImageEncoding.maxPixels` on its long side, as JPEG.
  var image: ModelImage
  /// A small copy for the preview row.
  var preview: UIImage?
}

extension String {
  nonisolated var trimmed: String {
    trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// The first line, trimmed; nil when it is empty.
  nonisolated var oneLine: String? {
    let line = trimmed.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmed
    return line?.isEmpty == false ? line : nil
  }

  /// At most `SharedContent.textLimit` characters.
  nonisolated var capped: String {
    count > SharedContent.textLimit ? String(prefix(SharedContent.textLimit)) : self
  }
}
