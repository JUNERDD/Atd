import AICore
import AppKit
import QuartzCore

/// Native placeholder shown inside a page window's glass container while the renderer boots and
/// paints its first frame, matching `WindowLoading` (`Empty` + `EmptyMedia` + `BrandLoader` +
/// `EmptyTitle`) on `--ata-surface-panel` at t=0ms without a blank frame.
final class WindowLoadingView: NSView {
  private let titleKey: ShellStringKey
  private let contentContainer = LoadingContent()
  private let loader = BrandLoaderView(frame: .zero)
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

    label.maximumNumberOfLines = 0
    label.isEditable = false
    label.isSelectable = false
    label.drawsBackground = false
    label.isBezeled = false

    contentContainer.addSubview(loader)
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
  /// `delayContent` holds the loader and label back for 100ms when waking a background-loaded page
  /// so a single-frame layer commit swaps straight to content without flashing the loader.
  func setActive(_ active: Bool, delayContent: Bool = false) {
    refreshAppearance()
    guard active != isActive else { return }
    isActive = active
    contentContainer.layer?.removeAnimation(forKey: "fade")
    if !active {
      loader.setAnimating(false)
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      contentContainer.layer?.opacity = 0
      CATransaction.commit()
      return
    }
    loader.setAnimating(true)
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
    loader.setAnimating(false)
    contentContainer.layer?.removeAnimation(forKey: "fade")
    reduceTransparency?.stop()
    reduceTransparency = nil
    if let stringsObserver { NotificationCenter.default.removeObserver(stringsObserver) }
    stringsObserver = nil
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
    let foreground =
      dark
      ? NSColor(srgbRed: 0.9803, green: 0.9803, blue: 0.9803, alpha: 1)
      : NSColor(srgbRed: 0.0394, green: 0.0394, blue: 0.0394, alpha: 1)
    loader.setColor(foreground.cgColor)

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
    let loaderSize = BrandLoaderMotion.boxSize
    let spacing: CGFloat = 16
    let totalHeight = loaderSize + (labelHeight > 0 ? spacing + labelHeight : 0)
    let centeredTop = ((bounds.height - totalHeight) / 2).rounded()
    let top = bounds.height >= totalHeight + 96 ? max(48, centeredTop) : max(0, centeredTop)
    loader.frame = NSRect(
      x: ((bounds.width - loaderSize) / 2).rounded(),
      y: top,
      width: loaderSize,
      height: loaderSize)
    label.frame = NSRect(
      x: ((bounds.width - availableWidth) / 2).rounded(),
      y: top + loaderSize + spacing,
      width: availableWidth,
      height: labelHeight)
  }
}

/// Lays the loader out above the title, as the page does: AppKit measures a subview's frame from
/// its superview's lower-left corner unless the superview is flipped.
private final class LoadingContent: NSView {
  override var isFlipped: Bool { true }
}
