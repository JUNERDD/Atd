import AICore
import AppKit

/// One source in the grid: its picture over a caption row (the source kind's symbol, the label
/// and a live dot while frames show), and the Enlarge control in the picture's top-trailing
/// corner while the content says so (``setControlShown(_:)``). A click focuses the tile, which
/// draws the system focus ring around its picture; a double-click, Return or Space enlarges it.
/// The arrow keys report a move, which the content resolves against the grid.
///
/// To assistive technologies the tile is one button named after its source, whose value is its
/// status and whose press enlarges it. Pixels never take input.
final class ComputerMonitorTile: NSView {
  /// What the tile reports to the content, which owns focus mode, the grid's arrangement and
  /// which tile shows its control.
  struct Events {
    var enlarge: () -> Void
    var hover: (Bool) -> Void
    var focus: (Bool) -> Void
    var move: (ComputerMonitorLayout.Direction) -> Void
  }

  let source: ComputerMonitorSource
  /// The tile's picture, which the focus stage borrows (``detachPicture()``).
  let picture: ComputerMonitorPicture
  private let kindSymbol = NSImageView()
  private let label = NSTextField(labelWithString: "")
  private let liveDot = LiveDot()
  private let control = ComputerMonitorGlassButton(symbolName: "arrow.up.left.and.arrow.down.right")
  private let events: Events
  private var pictureDetached = false
  /// The reason the accessibility value and actions describe; nil until they first do.
  private var described: PreviewReason??

  init(source: ComputerMonitorSource, events: Events) {
    self.source = source
    self.events = events
    picture = ComputerMonitorPicture(source: source)
    super.init(frame: .zero)
    control.onPress = { [weak self] in self?.events.enlarge() }
    kindSymbol.image = NSImage(
      systemSymbolName: source.kind.symbolName, accessibilityDescription: nil)
    kindSymbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
    kindSymbol.contentTintColor = .secondaryLabelColor
    label.stringValue = source.label
    label.toolTip = source.label
    label.font = .systemFont(ofSize: 13, weight: .medium)
    label.textColor = .labelColor
    label.lineBreakMode = .byTruncatingMiddle
    for view in [picture, kindSymbol, label, liveDot, control] as [NSView] {
      view.setAccessibilityElement(false)
      addSubview(view)
    }
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    setAccessibilityLabel(source.label)
    source.onChange = { [weak self] in self?.refresh() }
    localize()
  }

  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { true }

  /// Where the picture sits in the tile, also while the stage has borrowed it.
  var pictureSlot: CGRect { ComputerMonitorLayout.picture(inTile: bounds) }

  /// Hands the picture to the focus stage; the slot stays empty until ``reattachPicture()``.
  func detachPicture() -> ComputerMonitorPicture {
    pictureDetached = true
    control.setShown(false)
    return picture
  }

  /// Takes the picture back into its slot, under the control.
  func reattachPicture() {
    guard pictureDetached else { return }
    pictureDetached = false
    addSubview(picture, positioned: .below, relativeTo: control)
    picture.frame = pictureSlot
  }

  func setActive(_ active: Bool) { picture.setActive(active) }

  func setControlShown(_ shown: Bool) { control.setShown(shown && !pictureDetached) }

  func localize() {
    control.setLabel(ShellStrings.shared.text(.computerMonitorEnlarge))
    picture.localize()
    described = nil
    refresh()
  }

  override func layout() {
    super.layout()
    let slot = pictureSlot
    if !pictureDetached { picture.frame = slot }
    let inset = ComputerMonitorLayout.controlInset
    let diameter = ComputerMonitorGlassButton.diameter
    control.frame = CGRect(
      x: slot.maxX - inset - diameter, y: slot.minY + inset, width: diameter, height: diameter)
    let caption = ComputerMonitorLayout.caption(inTile: bounds)
    let symbolSize = kindSymbol.fittingSize
    kindSymbol.frame = CGRect(
      x: caption.minX, y: (caption.midY - symbolSize.height / 2).rounded(),
      width: symbolSize.width, height: symbolSize.height)
    let dot = LiveDot.diameter
    liveDot.frame = CGRect(
      x: caption.maxX - dot, y: (caption.midY - dot / 2).rounded(), width: dot, height: dot)
    let labelHeight = label.fittingSize.height
    let labelX = kindSymbol.frame.maxX + 6
    label.frame = CGRect(
      x: labelX, y: (caption.midY - labelHeight / 2).rounded(),
      width: max(0, liveDot.frame.minX - 8 - labelX), height: labelHeight)
    noteFocusRingMaskChanged()
  }

  /// Follows the source on every change, a new frame included; the accessibility description
  /// changes only with the reason.
  private func refresh() {
    picture.refresh()
    liveDot.isHidden = !source.isLive
    guard described != .some(source.reason) else { return }
    described = .some(source.reason)
    let strings = ShellStrings.shared
    setAccessibilityValue(
      source.reason.map { strings.text(ComputerMonitorStatusView.title($0)) }
        ?? strings.text(.computerMonitorLive))
    setAccessibilityCustomActions(
      source.reason == .permission
        ? [
          NSAccessibilityCustomAction(
            name: strings.text(.computerMonitorOpenPrivacySettings)
          ) {
            MainActor.assumeIsolated { ComputerMonitorStatusView.openPrivacySettings() }
            return true
          }
        ] : [])
  }

  // MARK: Pointer and keyboard

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
        owner: self))
  }

  override func mouseEntered(with event: NSEvent) { events.hover(true) }
  override func mouseExited(with event: NSEvent) { events.hover(false) }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    if event.clickCount == 2 { events.enlarge() }
  }

  override var acceptsFirstResponder: Bool { true }
  override var canBecomeKeyView: Bool { !pictureDetached }

  override func becomeFirstResponder() -> Bool {
    events.focus(true)
    return true
  }

  override func resignFirstResponder() -> Bool {
    events.focus(false)
    return true
  }

  override func keyDown(with event: NSEvent) {
    switch event.specialKey {
    case .leftArrow?: events.move(.left)
    case .rightArrow?: events.move(.right)
    case .upArrow?: events.move(.up)
    case .downArrow?: events.move(.down)
    case .carriageReturn?, .enter?, .newline?: events.enlarge()
    default:
      if event.charactersIgnoringModifiers == " " {
        events.enlarge()
      } else {
        super.keyDown(with: event)
      }
    }
  }

  override var focusRingMaskBounds: NSRect { pictureSlot }

  override func drawFocusRingMask() {
    let radius = ComputerMonitorLayout.cornerRadius
    NSBezierPath(roundedRect: pictureSlot, xRadius: radius, yRadius: radius).fill()
  }

  override func accessibilityPerformPress() -> Bool {
    events.enlarge()
    return true
  }
}

/// The caption's live status: a small green dot, redrawn in the current appearance so the
/// system green follows dark mode and Increase Contrast.
private final class LiveDot: NSView {
  static let diameter: CGFloat = 6

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
  }

  required init?(coder: NSCoder) { nil }

  override var wantsUpdateLayer: Bool { true }

  override func updateLayer() {
    layer?.cornerRadius = Self.diameter / 2
    layer?.backgroundColor = NSColor.systemGreen.cgColor
  }
}
