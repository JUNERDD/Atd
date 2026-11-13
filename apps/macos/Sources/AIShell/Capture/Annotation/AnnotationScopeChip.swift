import AICore
import AppKit

/// The text row's scope chip (the plan's prototype): what a text command reads, as
/// 「所选 · 2 段」, 「全部文字 · 14 段」 or 「所选 · 36 字」, in an accent-tinted capsule with the
/// text mode glyph and × to clear the picks. It is as wide as what it says, so × sits right after
/// the words; the row reserves its longest form (``widestLabel``) where it is placed.
final class AnnotationScopeChip: NSView {
  /// The ×: the selection goes, and with nothing selected text mode ends.
  var onClear: (() -> Void)?

  /// The label's type: tabular digits, so a count's width follows its digits only.
  private static let font = NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .medium)

  private let label = NSTextField(labelWithString: "")
  private let clear: AnnotationToolbarButton

  override init(frame: NSRect) {
    let strings = ShellStrings.shared
    clear = AnnotationToolbarButton(selection: nil, side: 22, action: #selector(clearClicked))
    let clearName = strings.text(CaptureTextStringKey.scopeClear)
    let glyph = AnnotationIcons.glyph(AnnotationIcons.cancel, label: clearName)
    glyph.size = NSSize(width: 12, height: 12)
    clear.image = glyph
    clear.toolTip = clearName
    clear.setAccessibilityLabel(clearName)
    super.init(frame: frame)
    clear.target = self
    let icon = NSImageView(
      image: AnnotationIcons.glyph(AnnotationIcons.selectText, label: ""))
    icon.image?.size = NSSize(width: 14, height: 14)
    icon.contentTintColor = .controlAccentColor
    icon.imageScaling = .scaleNone
    label.font = Self.font
    // The chip hugs its words: the label is never stretched or squeezed by the row.
    label.setContentHuggingPriority(.required, for: .horizontal)
    label.setContentCompressionResistancePriority(.required, for: .horizontal)
    label.textColor = .labelColor
    label.lineBreakMode = .byTruncatingTail
    let stack = NSStackView(views: [icon, label, clear])
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 6
    stack.setCustomSpacing(2, after: label)
    stack.edgeInsets = NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 3)
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 14),
      icon.heightAnchor.constraint(equalToConstant: 14),
      stack.leadingAnchor.constraint(equalTo: leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: topAnchor),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side),
    ])
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func setLabel(_ text: String) {
    guard label.stringValue != text else { return }
    label.stringValue = text
    setAccessibilityLabel(text)
  }

  /// The longest the label gets in the current language: either scope at two digits, or
  /// characters at four; the row measures itself with it for the room it reserves.
  static var widestLabel: String {
    let labels = CaptureResultLabels.current()
    let strings = ShellStrings.shared
    let texts = [
      labels.scope(CaptureTextScope(kind: .picked, count: 88)),
      labels.scope(CaptureTextScope(kind: .all, count: 88)),
      strings.text(CaptureTextModeStringKey.scopeCharacters, count: 8888),
    ]
    let width = { (text: String) in text.size(withAttributes: [.font: font]).width }
    return texts.max { width($0) < width($1) } ?? ""
  }

  /// The accent at 14% (30% in Dark Mode), a capsule.
  override func draw(_ dirtyRect: NSRect) {
    let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    NSColor.controlAccentColor.withAlphaComponent(dark ? 0.30 : 0.14).setFill()
    let radius = bounds.height / 2
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  @objc private func clearClicked() { onClear?() }
}
