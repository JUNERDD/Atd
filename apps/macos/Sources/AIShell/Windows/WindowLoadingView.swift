import AICore
import AppKit
import QuartzCore

/// Native placeholder shown inside a page window's glass container while the renderer boots and
/// paints its first frame, matching `WindowLoading` (`Empty` + `EmptyMedia` + `Spinner` +
/// `EmptyTitle`) on `--ata-surface-panel` at t=0ms without a blank frame.
final class WindowLoadingView: NSView {
  private let titleKey: ShellStringKey
  private let contentContainer = NSView()
  private let iconBadge = NSView()
  private let spinnerLayer = CAShapeLayer()
  private let label = NSTextField(wrappingLabelWithString: "")
  private var reduceTransparency: ReduceTransparencyObserver?
  private var stringsObserver: NSObjectProtocol?
  private var renderedText: String?
  private var renderedDark: Bool?
  private var isActive = false
  private var observingBackground = false

  init(frame frameRect: NSRect, titleKey: ShellStringKey) {
    self.titleKey = titleKey
    super.init(frame: frameRect)
    wantsLayer = true

    contentContainer.wantsLayer = true
    contentContainer.frame = bounds
    contentContainer.autoresizingMask = [.width, .height]
    contentContainer.layer?.opacity = 0

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

    contentContainer.addSubview(iconBadge)
    contentContainer.addSubview(label)
    addSubview(contentContainer)

    refreshAppearance(forceLabel: true)
    observingBackground = true
    observePanelBackground()

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

  /// Starts or stops the loading indicator while keeping the base panel fill painted from t=0ms.
  /// `delayContent` holds the badge and label back for 100ms when waking a background-loaded page
  /// so a single-frame layer commit swaps straight to content without flashing a spinner.
  func setActive(_ active: Bool, delayContent: Bool = false) {
    refreshAppearance()
    guard active != isActive else { return }
    isActive = active
    contentContainer.layer?.removeAnimation(forKey: "fade")
    if !active {
      spinnerLayer.removeAnimation(forKey: "spin")
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      contentContainer.layer?.opacity = 0
      CATransaction.commit()
      return
    }
    if spinnerLayer.animation(forKey: "spin") == nil { startSpinning() }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    contentContainer.layer?.opacity = 1
    CATransaction.commit()
    if delayContent {
      let fade = CABasicAnimation(keyPath: "opacity")
      fade.fromValue = 0.0
      fade.toValue = 1.0
      fade.beginTime = CACurrentMediaTime() + 0.1
      fade.duration = 0.15
      fade.fillMode = .backwards
      fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
      contentContainer.layer?.add(fade, forKey: "fade")
    }
  }

  func stop() {
    isActive = false
    observingBackground = false
    spinnerLayer.removeAnimation(forKey: "spin")
    contentContainer.layer?.removeAnimation(forKey: "fade")
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

  private func observePanelBackground() {
    guard observingBackground else { return }
    withObservationTracking {
      _ = PanelBackground.shared.setting
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.observingBackground else { return }
        self.refreshAppearance()
        self.observePanelBackground()
      }
    }
  }

  private func refreshAppearance(forceLabel: Bool = false) {
    let dark = GlassSurface.isDark
    layer?.backgroundColor =
      GlassSurface.fill(reduceTransparency: ReduceTransparencyObserver.isReduced).cgColor
    iconBadge.layer?.backgroundColor =
      dark
      ? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.08)
      : CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.05)
    let foreground =
      dark
      ? NSColor(srgbRed: 0.9803, green: 0.9803, blue: 0.9803, alpha: 1)
      : NSColor(srgbRed: 0.0394, green: 0.0394, blue: 0.0394, alpha: 1)
    spinnerLayer.strokeColor = foreground.cgColor
    if let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor {
      spinnerLayer.contentsScale = scale
    }

    let text = ShellStrings.shared.text(titleKey)
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
