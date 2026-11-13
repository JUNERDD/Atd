import AppKit
import Markdown

/// The runs of a paragraph, heading or table cell: emphasis, strong and strikethrough over the
/// text, inline code in the code font on its fill, links in the accent colour, an image as its
/// alt text, inline HTML as written, and every line break, soft or hard, as a newline: an answer
/// keeps the lines it was written in, as it did before Markdown.
enum ResultMarkdownInlines {
  /// What the runs being rendered take from what they are in.
  struct Traits: Hashable {
    var size = ResultTextStyle.size
    var weight = NSFont.Weight.regular
    var italic = false
    var code = false
    /// Code in a code block, whose block draws its fill.
    var block = false
    /// Digits of one width (a list's numbers).
    var digits = false
    var strike = false
    var color = ResultTextStyle.text
    var link: URL?
  }

  static func render(_ container: Markup, traits: Traits) -> NSAttributedString {
    let result = NSMutableAttributedString()
    append(container.children, traits: traits, to: result)
    return result
  }

  private static func append(
    _ children: MarkupChildren, traits: Traits, to result: NSMutableAttributedString
  ) {
    for child in children {
      var inner = traits
      switch child {
      case let text as Markdown.Text:
        run(text.string, traits, to: result)
      case is Emphasis:
        inner.italic = true
        append(child.children, traits: inner, to: result)
      case is Strong:
        inner.weight = .bold
        append(child.children, traits: inner, to: result)
      case is Strikethrough:
        inner.strike = true
        append(child.children, traits: inner, to: result)
      case let code as InlineCode:
        inner.code = true
        run(code.code, inner, to: result)
      case let link as Markdown.Link:
        // A destination that is no absolute URL (a relative path, a fragment) links nowhere.
        inner.link = link.destination.flatMap(URL.init(string:)).flatMap {
          $0.scheme == nil ? nil : $0
        }
        append(child.children, traits: inner, to: result)
      case let html as InlineHTML:
        run(html.rawHTML, traits, to: result)
      case is SoftBreak, is LineBreak:
        run("\n", traits, to: result)
      case let symbol as SymbolLink:
        run(symbol.destination ?? "", traits, to: result)
      default:
        // Containers (an image's alt text, inline attributes) show their text.
        if child.childCount > 0 {
          append(child.children, traits: traits, to: result)
        } else if let plain = child as? PlainTextConvertibleMarkup {
          run(plain.plainText, traits, to: result)
        }
      }
    }
  }

  /// A run of `string` with `traits`. Made through Core Foundation from a dictionary Foundation
  /// has already uniqued: a Swift dictionary would be bridged and uniqued again for every run.
  static func run(_ string: String, _ traits: Traits) -> NSAttributedString {
    let dictionary = dictionaries[traits] ?? uniqued(traits)
    return CFAttributedStringCreate(nil, string as CFString, dictionary) as NSAttributedString
  }

  private static func run(_ string: String, _ traits: Traits, to result: NSMutableAttributedString)
  {
    guard !string.isEmpty else { return }
    result.append(run(string, traits))
  }

  private static var dictionaries: [Traits: CFDictionary] = [:]

  private static func uniqued(_ traits: Traits) -> CFDictionary {
    let template = NSAttributedString(string: " ", attributes: attributes(traits))
    let dictionary = CFAttributedStringGetAttributes(template as CFAttributedString, 0, nil)!
    // Each link is its own entry; start over rather than grow without bound.
    if dictionaries.count > 512 { dictionaries = [:] }
    dictionaries[traits] = dictionary
    return dictionary
  }

  /// The attributes of a run with `traits`.
  static func attributes(_ traits: Traits) -> [NSAttributedString.Key: Any] {
    let font =
      if traits.digits {
        NSFont.monospacedDigitSystemFont(ofSize: traits.size, weight: traits.weight)
      } else if traits.code {
        ResultTextStyle.font(
          size: traits.size - (ResultTextStyle.size - ResultTextStyle.codeSize),
          weight: traits.weight, monospaced: true)
      } else {
        ResultTextStyle.font(size: traits.size, weight: traits.weight, italic: traits.italic)
      }
    var attributes: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: traits.color,
    ]
    if traits.code, !traits.block { attributes[.backgroundColor] = ResultTextStyle.codeFill }
    if traits.strike { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if let link = traits.link { attributes[.link] = link }
    return attributes
  }
}
