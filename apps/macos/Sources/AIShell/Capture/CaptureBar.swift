import AICore
import AppKit

/// One place among the bottom bar's keys: what to do, after the key to press drawn as a keycap
/// when there is one. A visible segment can reserve space for its alternative labels; actions
/// absent from the current mode contribute no width to the centred bar.
struct CaptureBarSegment: Equatable {
  /// The keycap's text (⌘A, R, Esc, ↵); nil for a gesture.
  var key: String?
  var label: String
  /// The other labels this place shows in another mode or phase.
  var reserved: [String] = []
}

/// The capture session's bottom bar (architecture C2), in place of the old hint badges: a 36 pt
/// glass capsule (``AnnotationGlassBar`` with a 4 pt padding, radius 18) holding the 截图 | 录屏
/// pair (``onMode``; the selected one keeps a neutral wash, the accent stays with the toolbar's
/// Done) and, after a hairline, the two or three keys the phase needs. A session that cannot
/// record, and the long screenshot's live phase, show the keys alone, inset alike at both ends.
/// The bar takes the presses on it, so none starts a selection under it, and has no drag.
final class CaptureBar: NSView {
  /// What the bar shows: the pair's mode (nil: no pair) and the keys.
  struct Content: Equatable {
    var mode: CaptureMode?
    var keys: [CaptureBarSegment]
  }

  /// A mode button was clicked.
  var onMode: ((CaptureMode) -> Void)?

  private let screenshot: AnnotationToolbarButton
  private let record: AnnotationToolbarButton
  private let keys = CaptureBarKeys()
  private let bar: AnnotationGlassBar
  private(set) var content: Content?

  init() {
    let strings = ShellStrings.shared
    func mode(_ name: CaptureBarStringKey, icon: String, key: String, action: Selector)
      -> AnnotationToolbarButton
    {
      let label = strings.text(name)
      let button = AnnotationToolbarButton(
        label: label, image: AnnotationIcons.glyph(icon, label: ""), selection: .wash,
        action: action)
      button.presentation = .captureMode
      button.toolTip = String(format: strings.text(.captureTooltipShortcut), label, key)
      return button
    }
    screenshot = mode(
      .captureBarScreenshot, icon: AnnotationIcons.screenshot, key: "⌘1",
      action: #selector(screenshotClicked))
    record = mode(
      .captureBarRecord, icon: AnnotationIcons.record, key: "⌘2",
      action: #selector(recordClicked))
    let pair = NSStackView(views: [screenshot, record])
    pair.spacing = 2
    pair.setAccessibilityElement(true)
    pair.setAccessibilityRole(.radioGroup)
    pair.setAccessibilityLabel(strings.text(.captureBarModes))
    bar = AnnotationGlassBar(
      groups: [[pair], [keys]], blending: .withinWindow, padding: 4, dividerSpacing: (8, 10))
    super.init(frame: .zero)
    screenshot.target = self
    record.target = self
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    setAccessibilityLabel(strings.text(.captureBarLabel))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// Shows `content`, sized to fit it.
  func update(_ content: Content) {
    guard content != self.content else { return }
    self.content = content
    bar.setGroup(0, hidden: content.mode == nil)
    keys.standsAlone = content.mode == nil
    screenshot.isSelected = content.mode == .screenshot
    record.isSelected = content.mode == .record
    keys.segments = content.keys
    setFrameSize(bar.fittingSize)
  }

  @objc private func screenshotClicked() { onMode?(.screenshot) }
  @objc private func recordClicked() { onMode?(.record) }
}

/// The Accessibility request (architecture C3): the copy of `capture.hint.accessibility` as one
/// labelled button on its own glass capsule beside the bottom bar; a click asks for trust
/// (``onRequest``). Disabled once the request was made this launch, when it only informs.
final class CaptureTrustRequest: NSView {
  var onRequest: (() -> Void)?

  private let button: AnnotationToolbarButton
  private let bar: AnnotationGlassBar

  init() {
    let text = ShellStrings.shared.text(.captureHintAccessibility)
    // The whole sentence: the labelled button's natural width stops at its longest label.
    let label = AnnotationToolbarButton.Label.self
    let width =
      label.padding * 2 + ceil(text.size(withAttributes: [.font: label.font]).width)
    button = AnnotationToolbarButton(
      label: text, image: nil, width: width, action: #selector(requested))
    bar = AnnotationGlassBar(groups: [[button]], blending: .withinWindow, padding: 4)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    button.target = self
    addSubview(bar)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  var isEnabled: Bool {
    get { button.isEnabled }
    set { button.isEnabled = newValue }
  }

  @objc private func requested() { onRequest?() }
}

/// The bar's keys: each segment's keycap and label, 14 pt apart, every label in the width its
/// segment reserves. Drawn, never hit: presses on it are the bar's.
private final class CaptureBarKeys: NSView {
  /// Set while the mode pair is hidden: the keys then start ``trailing`` in from the capsule's
  /// end too, so its two ends keep the same inset (decision D9).
  var standsAlone = false {
    didSet {
      guard standsAlone != oldValue else { return }
      invalidateIntrinsicContentSize()
      needsDisplay = true
    }
  }

  var segments: [CaptureBarSegment] = [] {
    didSet {
      guard segments != oldValue else { return }
      setAccessibilityElement(!segments.isEmpty)
      setAccessibilityRole(.staticText)
      setAccessibilityLabel(
        segments.map { [$0.key, $0.label].compactMap { $0 }.joined(separator: " ") }
          .joined(separator: ", "))
      invalidateIntrinsicContentSize()
      needsDisplay = true
    }
  }

  private static let labelFont = NSFont.systemFont(ofSize: 12)
  private static let keyFont = NSFont.systemFont(ofSize: 11, weight: .medium)
  private static let keyHeight: CGFloat = 18
  private static let keyInset: CGFloat = 4
  private static let keyGap: CGFloat = 5
  private static let segmentGap: CGFloat = 14
  /// After the last segment, so the text does not crowd the capsule's round end.
  private static let trailing: CGFloat = 10

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override var intrinsicContentSize: NSSize {
    let content = Self.rowWidth(segments)
    return NSSize(
      width: content == 0 ? 0 : leading + content + Self.trailing,
      height: AnnotationToolbarButton.side)
  }

  /// Before the first segment: none after the mode pair, whose labels have their own padding.
  private var leading: CGFloat { standsAlone ? Self.trailing : 0 }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    var x = leading
    for segment in segments {
      let start = x
      if let key = segment.key {
        let cap = CGRect(
          x: x, y: (bounds.height - Self.keyHeight) / 2, width: Self.keyWidth(key),
          height: Self.keyHeight)
        let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        NSColor.labelColor.withAlphaComponent(dark ? 0.10 : 0.07).setFill()
        NSBezierPath(roundedRect: cap, xRadius: 4, yRadius: 4).fill()
        let textWidth = Self.textWidth(key, font: Self.keyFont)
        drawText(key, font: Self.keyFont, color: .labelColor, x: x + (cap.width - textWidth) / 2)
        x += cap.width + Self.keyGap
      }
      drawText(segment.label, font: Self.labelFont, color: .secondaryLabelColor, x: x)
      x = start + Self.width(of: segment) + Self.segmentGap
    }
  }

  private static func width(of segment: CaptureBarSegment) -> CGFloat {
    let key = segment.key.map { keyWidth($0) + keyGap } ?? 0
    let label = ([segment.label] + segment.reserved).map { textWidth($0, font: labelFont) }.max()
    return key + (label ?? 0)
  }

  private static func rowWidth(_ segments: [CaptureBarSegment]) -> CGFloat {
    segments.map(Self.width(of:)).reduce(0, +)
      + Self.segmentGap * CGFloat(max(segments.count - 1, 0))
  }

  /// The content takes at least 18 pt, with the 4 pt inset outside it on both sides.
  private static func keyWidth(_ key: String) -> CGFloat {
    max(keyHeight, textWidth(key, font: keyFont)) + keyInset * 2
  }

  private static func textWidth(_ text: String, font: NSFont) -> CGFloat {
    NSAttributedString(string: text, attributes: [.font: font]).size().width.rounded(.up)
  }

  /// `text` at `x`, centred on the bar's height.
  private func drawText(_ text: String, font: NSFont, color: NSColor, x: CGFloat) {
    let string = NSAttributedString(
      string: text, attributes: [.font: font, .foregroundColor: color])
    string.draw(at: CGPoint(x: x, y: ((bounds.height - string.size().height) / 2).rounded()))
  }
}
