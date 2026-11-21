import AtdModel
import SwiftUI
import UIKit

/// The prototype's Lucide glyphs: Lucide 0.469.0's SVGs (ISC License, `Lucide-LICENSE`) with their
/// stroke set to the prototype's 1.9, as template images in `Lucide.xcassets` named as in Lucide.
/// They draw the tab bar's icons and every symbol in `StickerSymbols`, so a symbol added there
/// brings its glyph here. The prototype strokes a row's glyph at 1.8 and a tile's at 2.1; one
/// stroke keeps a single set, less than half a pixel apart.
public enum Lucide {
  /// Lucide's license, which ships with the glyphs.
  public static let license: String =
    Bundle.module.url(forResource: "Lucide-LICENSE", withExtension: nil)
    .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

  /// The glyph `name` for UIKit, such as the tab bar's items: a template image, tinted by its view.
  public static func image(_ name: String) -> UIImage? {
    UIImage(named: name, in: .module, with: nil)
  }
}

extension Image {
  /// The Lucide glyph `name` (such as `calendar-plus`), tinted like text.
  public init(lucide name: String) {
    self = Image(name, bundle: .module).renderingMode(.template)
  }
}

/// An item's symbol in ink: the Lucide glyph `StickerSymbols` pairs it with, `size` points square,
/// or, for a symbol outside the list, the SF Symbol drawn about as large.
public struct InkSymbol: View {
  let symbol: String
  let size: CGFloat

  public init(_ symbol: String, size: CGFloat) {
    self.symbol = symbol
    self.size = size
  }

  public var body: some View {
    if let glyph = StickerSymbols.glyph(for: symbol) {
      Image(lucide: glyph)
        .resizable()
        .frame(width: size, height: size)
    } else {
      Image(systemName: symbol)
        .font(.system(size: size * 0.88, weight: .medium))
        .frame(width: size, height: size)
    }
  }
}
