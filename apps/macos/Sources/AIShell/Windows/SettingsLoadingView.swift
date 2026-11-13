import AICore
import AppKit
import QuartzCore

/// Native placeholder shown inside the Settings window's glass container while the renderer boots
/// and draws `#settings`, matching `WindowLoading` (`Empty` + `EmptyMedia` + `Spinner` +
/// `EmptyTitle`) at t=0ms without a blank frame.
final class SettingsLoadingView: NSView {
  private let iconBadge = NSView()
  private let spinnerLayer = CAShapeLayer()
  private let label = NSTextField(wrappingLabelWithString: "")
  private var reduceTransparency: ReduceTransparencyObserver?
  private var stringsObserver: NSObjectProtocol?
  private var renderedText: String?
  private var renderedDark: Bool?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true

    iconBadge.wantsLayer = true
    iconBadge.setAccessibilityElement(false)
    iconBadge.layer?.cornerRadius = 14
    iconBadge.layer?.cornerCurve = .continuous

    let path = CGMutablePath()
    path.addArc(
      center: CGPoint(x: 8, y: 8), radius: 6, startAngle: 0, endAngle: 0.4 * .pi, clockwise: true)
    spinnerLayer.path = path
    spinnerLayer.bounds = CGRect(x: 0, y: 0, width: 16, height: 16)
    spinnerLayer.position = CGPoint(x: 20, y: 20)
    spinnerLayer.lineWidth = 4.0 / 3.0
    spinnerLayer.lineCap = .round
    spinnerLayer.fillColor = nil
    iconBadge.layer?.addSublayer(spinnerLayer)

    label.maximumNumberOfLines = 0
    label.isEditable = false
    label.isSelectable = false
    label.drawsBackground = false
    label.isBezeled = false

    addSubview(iconBadge)
    addSubview(label)

    refreshAppearance(forceLabel: true)
    startSpinning()

    reduceTransparency = ReduceTransparencyObserver { [weak self] _ in
      self?.refreshAppearance()
    }
    stringsObserver = NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.localize() }
    }
  }

  isolated deinit {
    reduceTransparency?.stop()
    if let stringsObserver { NotificationCenter.default.removeObserver(stringsObserver) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var isFlipped: Bool { true }
  override var mouseDownCanMoveWindow: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    super.hitTest(point) == nil ? nil : self
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshAppearance()
  }

  func stop() {
    spinnerLayer.removeAnimation(forKey: "spin")
    reduceTransparency?.stop()
    reduceTransparency = nil
    if let stringsObserver { NotificationCenter.default.removeObserver(stringsObserver) }
    stringsObserver = nil
  }

  private func startSpinning() {
    let animation = CABasicAnimation(keyPath: "transform.rotation.z")
    animation.fromValue = 0.0
    animation.toValue = -2.0 * Double.pi
    animation.duration = 1.0
    animation.repeatCount = .infinity
    animation.timingFunction = CAMediaTimingFunction(name: .linear)
    animation.isRemovedOnCompletion = false
    spinnerLayer.add(animation, forKey: "spin")
  }

  private func localize() {
    refreshAppearance(forceLabel: true)
    needsLayout = true
  }

  private func refreshAppearance(forceLabel: Bool = false) {
    let dark = GlassSurface.isDark
    layer?.backgroundColor =
      GlassSurface.fill(reduceTransparency: ReduceTransparencyObserver.isReduced).cgColor
    iconBadge.layer?.backgroundColor =
      dark
      ? CGColor(srgbRed: 0.1494, green: 0.1494, blue: 0.1494, alpha: 1)
      : CGColor(srgbRed: 0.9606, green: 0.9606, blue: 0.9606, alpha: 1)
    let foreground =
      dark
      ? NSColor(srgbRed: 0.9803, green: 0.9803, blue: 0.9803, alpha: 1)
      : NSColor(srgbRed: 0.0394, green: 0.0394, blue: 0.0394, alpha: 1)
    spinnerLayer.strokeColor = foreground.cgColor
    if let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor {
      spinnerLayer.contentsScale = scale
    }

    let text = ShellStrings.shared.text(.windowSettingsLoading)
    guard forceLabel || renderedText != text || renderedDark != dark else { return }
    renderedText = text
    renderedDark = dark

    let font = NSFont.systemFont(ofSize: 18, weight: .medium)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byWordWrapping
    paragraph.minimumLineHeight = 28
    paragraph.maximumLineHeight = 28
    label.attributedStringValue = NSAttributedString(
      string: text,
      attributes: [
        .font: font,
        .kern: -0.45,
        .foregroundColor: foreground,
        .paragraphStyle: paragraph,
        .baselineOffset: (28 - (font.ascender - font.descender)) / 4,
      ])
  }

  override func layout() {
    super.layout()
    refreshAppearance()
    let availableWidth = max(0, min(384, bounds.width - 96))
    label.preferredMaxLayoutWidth = availableWidth
    let labelHeight =
      availableWidth > 0
      ? ceil(
        label.sizeThatFits(NSSize(width: availableWidth, height: CGFloat.greatestFiniteMagnitude))
          .height)
      : 0
    let badgeSize: CGFloat = 40
    let spacing: CGFloat = 16
    let totalHeight = badgeSize + (labelHeight > 0 ? spacing + labelHeight : 0)
    let centeredTop = ((bounds.height - totalHeight) / 2).rounded()
    let top = bounds.height >= totalHeight + 96 ? max(48, centeredTop) : max(0, centeredTop)
    iconBadge.frame = NSRect(
      x: ((bounds.width - badgeSize) / 2).rounded(),
      y: top,
      width: badgeSize,
      height: badgeSize)
    label.frame = NSRect(
      x: ((bounds.width - availableWidth) / 2).rounded(),
      y: top + badgeSize + spacing,
      width: availableWidth,
      height: labelHeight)
  }
}
