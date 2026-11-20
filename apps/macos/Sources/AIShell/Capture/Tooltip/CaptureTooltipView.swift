import AppKit

/// Compact glass tooltip pill rendered by ``CaptureTooltipPresenter``: a 26 pt rounded pill
/// backed by ``NativeMaterialView`` with an optional trailing keycap pill.
final class CaptureTooltipView: NSView {
  static let height: CGFloat = 26
  static let cornerRadius: CGFloat = 8
  fileprivate static let horizontalInset: CGFloat = 9
  fileprivate static let shortcutGap: CGFloat = 6
  fileprivate static let keyHeight: CGFloat = 18
  fileprivate static let keyInset: CGFloat = 4
  fileprivate static let titleRoomBuffer: CGFloat = 2
  fileprivate static let titleFont = NSFont.systemFont(ofSize: 12, weight: .medium)
  fileprivate static let keyFont = NSFont.systemFont(ofSize: 11, weight: .medium)

  private let material = NativeMaterialView(.capsule(.behindWindow))
  private let content = TooltipContentView()
  private var isDark = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    GlassSurface.attach(material, content: content)
    addSubview(material.view)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override var intrinsicContentSize: NSSize { content.preferredSize }

  override func layout() {
    super.layout()
    material.view.frame = bounds
    GlassSurface.shape(material, content: content, cornerRadius: Self.cornerRadius)
    updateChrome()
    content.needsLayout = true
    material.view.layoutSubtreeIfNeeded()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateChrome()
  }

  /// Updates the displayed tooltip string and appearance, returning the measured pill size.
  @discardableResult
  func update(text: String, dark: Bool) -> NSSize {
    isDark = dark
    let targetAppearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    appearance = targetAppearance
    GlassSurface.pin(material, to: targetAppearance)
    let parsed = Self.parse(text)
    content.configure(title: parsed.title, shortcut: parsed.shortcut, dark: dark)
    updateChrome()
    invalidateIntrinsicContentSize()
    let size = content.preferredSize
    setFrameSize(size)
    needsLayout = true
    content.needsLayout = true
    layoutSubtreeIfNeeded()
    return size
  }

  /// Splits trailing `(KEY)` or `（KEY）` shortcuts up to 8 characters from `text`.
  static func parse(_ text: String) -> (title: String, shortcut: String?) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let pair: (open: Character, close: Character)? =
      trimmed.hasSuffix(")") ? ("(", ")") : (trimmed.hasSuffix("）") ? ("（", "）") : nil)
    guard let pair else { return (trimmed, nil) }
    let body = trimmed.dropLast()
    guard let openIndex = body.lastIndex(of: pair.open) else { return (trimmed, nil) }
    let title = String(body[..<openIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
    let key = String(body[body.index(after: openIndex)...]).trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !title.isEmpty, (1...8).contains(key.count), !key.contains(pair.open),
      !key.contains(pair.close)
    else { return (trimmed, nil) }
    return (title, key)
  }

  private func updateChrome() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      content.updateChrome(dark: isDark)
    }
  }
}

private final class TooltipContentView: NSView {
  private let titleLabel = TooltipContentView.makeLabel(
    font: CaptureTooltipView.titleFont, color: .labelColor, alignment: .left)
  private let keycapView = NSView()
  private let keyLabel = TooltipContentView.makeLabel(
    font: CaptureTooltipView.keyFont, color: .secondaryLabelColor, alignment: .center)
  private var keyWidth: CGFloat = 0
  private var isDark = false
  private(set) var preferredSize = NSSize(width: 0, height: CaptureTooltipView.height)

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    keycapView.wantsLayer = true
    keycapView.layer?.cornerCurve = .continuous
    keycapView.layer?.cornerRadius = 4.5
    keycapView.layer?.actions = [
      "bounds": NSNull(), "position": NSNull(), "backgroundColor": NSNull(),
    ]
    keycapView.isHidden = true
    keycapView.addSubview(keyLabel)
    addSubview(titleLabel)
    addSubview(keycapView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    effectiveAppearance.performAsCurrentDrawingAppearance {
      updateChrome(dark: isDark)
    }
  }

  func configure(title: String, shortcut: String?, dark: Bool) {
    isDark = dark
    titleLabel.stringValue = title
    let titleWidth =
      Self.width(of: title, font: CaptureTooltipView.titleFont)
      + CaptureTooltipView.titleRoomBuffer
    if let shortcut {
      keyLabel.stringValue = shortcut
      keycapView.isHidden = false
      let rawKeyWidth = Self.width(of: shortcut, font: CaptureTooltipView.keyFont)
      keyWidth = max(
        CaptureTooltipView.keyHeight,
        rawKeyWidth + CaptureTooltipView.titleRoomBuffer + CaptureTooltipView.keyInset * 2)
      preferredSize = NSSize(
        width: CaptureTooltipView.horizontalInset + titleWidth + CaptureTooltipView.shortcutGap
          + keyWidth + CaptureTooltipView.horizontalInset,
        height: CaptureTooltipView.height)
    } else {
      keyLabel.stringValue = ""
      keycapView.isHidden = true
      keyWidth = 0
      preferredSize = NSSize(
        width: CaptureTooltipView.horizontalInset * 2 + titleWidth,
        height: CaptureTooltipView.height)
    }
    needsLayout = true
  }

  func updateChrome(dark: Bool) {
    let surfaceFill = GlassSurface.fill(
      reduceTransparency: ReduceTransparencyObserver.isReduced, dark: dark
    ).cgColor
    let keyBg = NSColor.labelColor.withAlphaComponent(dark ? 0.14 : 0.08).cgColor
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer?.backgroundColor = surfaceFill
    keycapView.layer?.backgroundColor = keyBg
    CATransaction.commit()
  }

  override func layout() {
    super.layout()
    let h = bounds.height
    let w = bounds.width
    guard h > 0, w > 0 else { return }

    let inset = CaptureTooltipView.horizontalInset
    let titleSize = titleLabel.sizeThatFits(
      NSSize(width: CGFloat.greatestFiniteMagnitude, height: h))
    let titleH = ceil(titleSize.height)
    let titleY = ((h - titleH) / 2).rounded()

    if !keycapView.isHidden, keyWidth > 0 {
      let keyX = max(inset, w - inset - keyWidth)
      let keyY = ((h - CaptureTooltipView.keyHeight) / 2).rounded()
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      keycapView.frame = NSRect(
        x: keyX, y: keyY, width: keyWidth, height: CaptureTooltipView.keyHeight)
      CATransaction.commit()
      let keyTextSize = keyLabel.sizeThatFits(
        NSSize(width: keyWidth, height: CaptureTooltipView.keyHeight))
      let keyTextH = ceil(keyTextSize.height)
      keyLabel.frame = NSRect(
        x: 0, y: ((CaptureTooltipView.keyHeight - keyTextH) / 2).rounded(),
        width: keyWidth, height: keyTextH)
      let maxTitleW = max(0, keyX - (inset - 1) - 2)
      titleLabel.frame = NSRect(
        x: inset - 1, y: titleY, width: min(ceil(titleSize.width), maxTitleW), height: titleH)
    } else {
      let maxTitleW = max(0, w - (inset - 1) * 2)
      titleLabel.frame = NSRect(
        x: inset - 1, y: titleY, width: min(ceil(titleSize.width), maxTitleW), height: titleH)
    }
  }

  private static func makeLabel(font: NSFont, color: NSColor, alignment: NSTextAlignment)
    -> NSTextField
  {
    let label = NSTextField(labelWithString: "")
    label.font = font
    label.textColor = color
    label.alignment = alignment
    label.lineBreakMode = .byClipping
    label.maximumNumberOfLines = 1
    label.usesSingleLineMode = true
    label.cell?.wraps = false
    label.cell?.isScrollable = false
    return label
  }

  private static func width(of text: String, font: NSFont) -> CGFloat {
    ceil(NSAttributedString(string: text, attributes: [.font: font]).size().width)
  }
}
