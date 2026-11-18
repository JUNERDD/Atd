import AppKit
import QuartzCore

/// Custom rounded action button for ``WindowRecoveryView`` (`03-contracts-routes-and-ui.md` §4.3).
///
/// Maps its cursor strictly through ``PointerRole/init(button:)`` (`AGENTS.md:125`), never raw
/// `NSCursor`, and measures its full localized label width so primary actions never clip into
/// ellipses.
final class RecoveryActionButton: NSButton {
  enum Prominence {
    case primary
    case secondary
  }

  let prominence: Prominence
  private var hovered = false
  private var tracking: NSTrackingArea?
  private(set) var naturalLabelWidth: CGFloat = 88

  override var mouseDownCanMoveWindow: Bool { false }

  override var isEnabled: Bool {
    didSet {
      refreshAppearance()
      window?.invalidateCursorRects(for: self)
    }
  }

  override var isHighlighted: Bool {
    didSet { refreshAppearance() }
  }

  init(prominence: Prominence, target: AnyObject?, action: Selector) {
    self.prominence = prominence
    super.init(frame: .zero)
    isBordered = false
    bezelStyle = .regularSquare
    wantsLayer = true
    layer?.cornerRadius = 14
    layer?.cornerCurve = .continuous
    self.target = target
    self.action = action
    setButtonType(.momentaryChange)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  var resolvedCursor: NSCursor {
    PointerRole(button: self).cursor
  }

  override func resetCursorRects() {
    super.resetCursorRects()
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let next = NSTrackingArea(
      rect: .zero,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil)
    addTrackingArea(next)
    tracking = next
  }

  override func mouseEntered(with event: NSEvent) {
    hovered = true
    refreshAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    hovered = false
    refreshAppearance()
  }

  func configureLabel(_ text: String) {
    title = text
    setAccessibilityLabel(text)
    refreshAppearance()
  }

  func refreshAppearance() {
    let dark = GlassSurface.isDark
    let font = NSFont.systemFont(ofSize: 13, weight: .medium)
    let textColor: NSColor
    let bgColor: CGColor
    let borderColor: CGColor?

    switch prominence {
    case .primary:
      let alpha: CGFloat = !isEnabled ? 0.45 : (isHighlighted ? 0.82 : (hovered ? 0.92 : 1.0))
      bgColor =
        dark
        ? CGColor(srgbRed: 0.96, green: 0.96, blue: 0.97, alpha: alpha)
        : CGColor(srgbRed: 0.09, green: 0.09, blue: 0.11, alpha: alpha)
      textColor =
        dark
        ? NSColor(srgbRed: 0.06, green: 0.06, blue: 0.07, alpha: isEnabled ? 1 : 0.7)
        : NSColor(srgbRed: 0.98, green: 0.98, blue: 0.99, alpha: isEnabled ? 1 : 0.7)
      borderColor = nil
    case .secondary:
      let baseAlpha: CGFloat =
        !isEnabled ? 0.04 : (isHighlighted ? 0.16 : (hovered ? 0.11 : 0.07))
      bgColor =
        dark
        ? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: baseAlpha)
        : CGColor(srgbRed: 0, green: 0, blue: 0, alpha: baseAlpha)
      textColor =
        dark
        ? NSColor(srgbRed: 0.96, green: 0.96, blue: 0.97, alpha: isEnabled ? 1 : 0.45)
        : NSColor(srgbRed: 0.09, green: 0.09, blue: 0.11, alpha: isEnabled ? 1 : 0.45)
      borderColor =
        dark
        ? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.12)
        : CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.10)
    }

    layer?.backgroundColor = bgColor
    layer?.borderWidth = borderColor == nil ? 0 : 1
    layer?.borderColor = borderColor

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byClipping
    let attr = NSAttributedString(
      string: title,
      attributes: [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
      ])
    attributedTitle = attr
    naturalLabelWidth = max(88, ceil(attr.size().width) + 28)
  }
}
