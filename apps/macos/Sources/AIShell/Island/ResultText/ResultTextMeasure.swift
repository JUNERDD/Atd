import AppKit

/// The result text's layout manager, on screen and off: inline code's fill drawn rounded and a
/// little wider than its glyphs. Every other fill (the selection's) draws as AppKit draws it.
nonisolated final class ResultLayoutManager: NSLayoutManager {
  override func fillBackgroundRectArray(
    _ rectArray: UnsafePointer<NSRect>, count rectCount: Int,
    forCharacterRange charRange: NSRange, color: NSColor
  ) {
    guard color == ResultTextStyle.codeFill else {
      return super.fillBackgroundRectArray(
        rectArray, count: rectCount, forCharacterRange: charRange, color: color)
    }
    for index in 0..<rectCount {
      let rect = rectArray[index].insetBy(dx: -2, dy: 0)
      NSBezierPath(roundedRect: rect, xRadius: 3, yRadius: 3).fill()
    }
  }
}

/// The sizes result texts lay out to, off screen: measuring a card builds new views each time,
/// but none of them lays text out. A few TextKit 1 stacks, each kept at a width, take each text
/// as an edit of the one they showed last (``ResultTextEdit``), so an answer streaming in lays
/// out only its new end; and a size, once laid out, is kept for that rendering and width.
enum ResultTextMeasure {
  private final class Stack {
    let storage = NSTextStorage()
    let manager = ResultLayoutManager()
    let container = NSTextContainer()
    var shown = NSAttributedString()

    init() {
      storage.addLayoutManager(manager)
      manager.addTextContainer(container)
      container.lineFragmentPadding = 0
    }

    var width: CGFloat { container.size.width }

    func show(_ text: NSAttributedString, width: CGFloat) {
      if container.size.width != width {
        container.size = NSSize(width: width, height: .greatestFiniteMagnitude)
      }
      guard let start = ResultTextEdit.firstChange(from: shown, to: text) else { return }
      ResultTextEdit.apply(text, from: start, to: storage)
      shown = text
    }
  }

  /// Most recent first.
  private static var stacks: [Stack] = []
  /// A size laid out: for the width proposed, and with none, for the `maxWidth` it was capped at.
  private struct Measured {
    let text: NSAttributedString
    let width: CGFloat?
    let cap: CGFloat
    let size: CGSize

    func matches(_ text: NSAttributedString, width: CGFloat?, cap: CGFloat) -> Bool {
      self.text === text && self.width == width && (width != nil || self.cap == cap)
    }
  }

  private static var sizes: [Measured] = []

  /// The size `text` lays out to `width` wide: that width, and the height its lines take; with
  /// no width, as wide as its widest line up to `maxWidth`.
  static func size(of text: NSAttributedString, width: CGFloat?, maxWidth: CGFloat) -> CGSize {
    if let kept = sizes.first(where: { $0.matches(text, width: width, cap: maxWidth) }) {
      return kept.size
    }
    let layout = width ?? maxWidth
    let stack = stack(width: layout, for: text)
    stack.show(text, width: layout)
    let used = usedRect(stack.manager, stack.container)
    let size = CGSize(width: width ?? ceil(used.width), height: ceil(used.height))
    sizes.insert(Measured(text: text, width: width, cap: maxWidth, size: size), at: 0)
    if sizes.count > 24 { sizes.removeLast() }
    return size
  }

  /// The rectangle `manager` lays the text in `container` out in; empty text still takes a line,
  /// as an empty SwiftUI text does.
  static func usedRect(_ manager: NSLayoutManager, _ container: NSTextContainer) -> CGRect {
    guard manager.textStorage?.length ?? 0 > 0 else {
      return CGRect(x: 0, y: 0, width: 0, height: emptyHeight)
    }
    manager.ensureLayout(for: container)
    return manager.usedRect(for: container)
  }

  private static let emptyHeight = NSLayoutManager().defaultLineHeight(
    for: ResultTextStyle.font(size: ResultTextStyle.size))

  /// The stack to lay `text` out `width` wide in: the one showing it, else one at that width,
  /// else the one used longest ago.
  private static func stack(width: CGFloat, for text: NSAttributedString) -> Stack {
    let index =
      stacks.firstIndex { $0.width == width && $0.shown === text }
      ?? stacks.firstIndex { $0.width == width }
      ?? (stacks.count < 3 ? nil : stacks.count - 1)
    let stack = index.map { stacks.remove(at: $0) } ?? Stack()
    stacks.insert(stack, at: 0)
    return stack
  }
}
