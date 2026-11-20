import AtdModel
import SwiftUI
import UIKit

/// The spot illustrations at the head of the tabs and the Atd mark, from `InkArt.json`: path data
/// exported from the design assets of the prototype. Each illustration fills a 160 × 112 box.
enum InkArt {
  enum Name: String, Hashable {
    case commands, me
  }

  /// One stroke or shape of an illustration, in drawing order.
  struct Mark: Identifiable {
    enum Fill {
      case paper, deep, ink, shade
    }

    let id: Int
    let path: Path
    let fill: Fill?
    /// The stroke width in view box units; 0 for a shape drawn without an edge.
    let line: CGFloat
  }

  static func marks(_ name: Name) -> [Mark] {
    file.art[name.rawValue] ?? []
  }

  /// The Atd mark (two drops) as a template image `side` points square, for the 问 Atd button.
  static func markImage(side: CGFloat) -> UIImage {
    // The mark is drawn in an 84-point box that starts at (18, 18).
    let transform = CGAffineTransform(translationX: -18, y: -18)
      .concatenating(CGAffineTransform(scaleX: side / 84, y: side / 84))
    let path = file.mark.applying(transform).cgPath
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { context in
      context.cgContext.addPath(path)
      context.cgContext.setFillColor(UIColor.black.cgColor)
      context.cgContext.fillPath()
    }
    return image.withRenderingMode(.alwaysTemplate)
  }

  private struct File {
    var mark: Path
    var art: [String: [Mark]]
  }

  private static let file: File = {
    struct Stored: Decodable {
      var mark: String
      var art: [String: [[String]]]
    }
    guard let url = Bundle.module.url(forResource: "InkArt", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let stored = try? JSONDecoder().decode(Stored.self, from: data)
    else {
      // The artwork ships in this module's bundle; without it the build itself is broken.
      fatalError("InkArt.json is missing from the app")
    }
    let art = stored.art.mapValues { rows in
      rows.enumerated().map { index, row in mark(index, row) }
    }
    return File(mark: SVGPath.path(stored.mark), art: art)
  }()

  /// A mark from its stored row: `[style, path data, transform?]`. Styles: `p` paper fill, `q`
  /// deep fill, `k` ink fill, `s` soft shade without an edge, `t` thin stroke, empty for a plain
  /// 2-unit stroke.
  private static func mark(_ index: Int, _ row: [String]) -> Mark {
    let style = row.first ?? ""
    var path = SVGPath.path(row.count > 1 ? row[1] : "")
    if row.count > 2 { path = path.applying(SVGPath.transform(row[2])) }
    let fill: Mark.Fill? =
      switch style {
      case "p": .paper
      case "q": .deep
      case "k": .ink
      case "s": .shade
      default: nil
      }
    let line: CGFloat = style == "s" ? 0 : style == "t" ? 1.3 : 2
    return Mark(id: index, path: path, fill: fill, line: line)
  }
}

/// A tab's spot illustration, inked on the paper. It draws itself in, stroke by stroke, the first
/// time it appears in a session, and appears whole after that or with Reduce Motion on.
struct Doodle: View {
  let name: InkArt.Name
  var width: CGFloat = 150
  @State private var drawn: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// Illustrations already drawn in this session.
  private static var shown: Set<InkArt.Name> = []

  init(_ name: InkArt.Name, width: CGFloat = 150) {
    self.name = name
    self.width = width
    _drawn = State(initialValue: Self.shown.contains(name))
  }

  var body: some View {
    let scale = width / 160
    ZStack(alignment: .topLeading) {
      ForEach(InkArt.marks(name)) { mark in
        MarkView(mark: mark, scale: scale, drawn: drawn, animated: !reduceMotion)
      }
    }
    .frame(width: width, height: width * 112 / 160, alignment: .topLeading)
    .accessibilityHidden(true)
    .onAppear {
      Self.shown.insert(name)
      drawn = true
    }
  }
}

private struct MarkView: View {
  let mark: InkArt.Mark
  let scale: CGFloat
  let drawn: Bool
  let animated: Bool

  var body: some View {
    let path = mark.path.applying(CGAffineTransform(scaleX: scale, y: scale))
    let delay = Double(mark.id) * 0.026
    ZStack(alignment: .topLeading) {
      if let fill = mark.fill {
        path.fill(color(fill))
          .opacity(drawn ? 1 : 0)
          .animation(
            animated ? .easeOut(duration: 0.42).delay(delay + (mark.line > 0 ? 0.26 : 0)) : nil,
            value: drawn)
      }
      if mark.line > 0 {
        path.trim(from: 0, to: drawn ? 1 : 0)
          .stroke(
            Color.primary,
            style: StrokeStyle(lineWidth: mark.line * scale, lineCap: .round, lineJoin: .round)
          )
          .animation(animated ? .easeOut(duration: 0.56).delay(delay) : nil, value: drawn)
      }
    }
  }

  private func color(_ fill: InkArt.Mark.Fill) -> Color {
    switch fill {
    case .paper: InkColor.paper
    case .deep: InkColor.deep
    case .ink: .primary
    case .shade: InkColor.shade
    }
  }
}

/// How a command is told apart: its hue as a highlighter blob with its symbol inked on top. The
/// blob's shape and a slight tilt come from `seed`, so a command looks the same everywhere.
struct Sticker: View {
  let symbol: String
  let tint: CommandTint
  let seed: String
  var size: CGFloat = 40

  var body: some View {
    let hash = inkSeed(seed + symbol + tint.rawValue)
    Image(systemName: symbol)
      .font(.system(size: size * 0.46, weight: .medium))
      .foregroundStyle(InkColor.stickerGlyph(tint))
      .frame(width: size, height: size)
      .background(
        InkColor.sticker(tint),
        in: InkShape(corners: InkCorners.blobs[hash % InkCorners.blobs.count], wobble: 0)
      )
      .rotationEffect(.degrees(Double((hash >> 3) % 9) - 4))
      .accessibilityHidden(true)
  }
}

/// A plain inked symbol for a settings row: no color, because it identifies nothing.
struct Glyph: View {
  let symbol: String

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 19, weight: .regular))
      .foregroundStyle(.primary)
      .frame(width: 28, height: 28)
      .accessibilityHidden(true)
  }
}
