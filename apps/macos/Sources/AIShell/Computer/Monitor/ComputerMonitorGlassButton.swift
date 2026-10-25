import AppKit

/// The Enlarge control over a hovered or keyboard-focused tile's picture: a circle of the shell's
/// floating glass, a ``NativeMaterialView`` capsule blending within the window on
/// ``GlassSurface``'s fill and scheme. That is Liquid Glass on macOS 26 and the HUD material on
/// macOS 15, exactly as the shell's other floating controls, and its glyph stays legible over
/// any picture because the surface's fill does not adapt to it. It fades in and out without
/// moving.
///
/// The tile, an accessibility button whose press enlarges, speaks for the control, so it stays
/// out of the accessibility tree and out of the key view loop.
final class ComputerMonitorGlassButton: NSView {
  static let diameter: CGFloat = 28

  private let material = NativeMaterialView(.capsule(.withinWindow))
  private let surface = NSView()
  private let button = NSButton()
  private var shown = false
  var onPress: (() -> Void)?

  init(symbolName: String) {
    super.init(frame: .zero)
    button.isBordered = false
    button.imagePosition = .imageOnly
    button.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)?
      .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold))
    button.contentTintColor = .labelColor
    button.refusesFirstResponder = true
    button.target = self
    button.action = #selector(pressed)
    button.setAccessibilityElement(false)
    button.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(button)
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
      button.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
      button.topAnchor.constraint(equalTo: surface.topAnchor),
      button.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
    ])
    GlassSurface.attach(material, content: surface)
    addSubview(material.view)
    setAccessibilityElement(false)
    alphaValue = 0
    isHidden = true
  }

  required init?(coder: NSCoder) { nil }

  /// The control's name, shown as its tooltip.
  func setLabel(_ label: String) { button.toolTip = label }

  /// Fades the control in or out over 0.15 s; once faded out it is hidden, so it takes no
  /// clicks.
  func setShown(_ shown: Bool) {
    guard shown != self.shown else { return }
    self.shown = shown
    if shown { isHidden = false }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.15
      animator().alphaValue = shown ? 1 : 0
    } completionHandler: {
      MainActor.assumeIsolated { [weak self] in
        guard let self, !self.shown else { return }
        self.isHidden = true
      }
    }
  }

  override func layout() {
    super.layout()
    material.view.frame = bounds
    GlassSurface.shape(material, content: surface, cornerRadius: bounds.height / 2)
  }

  @objc private func pressed() { onPress?() }
}
