import AppKit

/// The app's card in the permission guide: its icon and name in a rounded bar, which the user
/// drags into System Settings' permission list. The drag carries the app bundle as a file, and
/// its image is the bar itself, held where it was picked up, so what moves under the pointer is
/// the card the guide showed. While the drag runs, the card left in the panel fades to a
/// placeholder.
final class PermissionGuideCard: NSView, NSDraggingSource {
  private let appURL: URL
  private var pressedAt: NSPoint?
  private var dragging = false

  static let radius: CGFloat = 12
  /// The 28pt icon with 8pt above and below.
  static let height: CGFloat = 44

  init(appURL: URL, name: String, dragHint: String) {
    self.appURL = appURL
    super.init(frame: .zero)
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    setAccessibilityLabel(name)
    setAccessibilityHelp(dragHint)

    let icon = NSImageView(image: NSWorkspace.shared.icon(forFile: appURL.path))
    icon.imageScaling = .scaleProportionallyUpOrDown
    let title = NSTextField(labelWithString: name)
    title.font = .systemFont(ofSize: 13, weight: .medium)
    title.lineBreakMode = .byTruncatingTail
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let hand = NSImageView(
      image: NSImage(systemSymbolName: "hand.draw", accessibilityDescription: nil) ?? NSImage())
    hand.symbolConfiguration = .init(pointSize: 13, weight: .regular)
    hand.contentTintColor = .secondaryLabelColor
    let hint = NSTextField(labelWithString: dragHint)
    hint.font = .systemFont(ofSize: 11)
    hint.textColor = .secondaryLabelColor

    for view in [icon, hand, hint] as [NSView] {
      view.setContentHuggingPriority(.required, for: .horizontal)
    }
    let row = NSStackView(views: [icon, title, NSView(), hand, hint])
    row.orientation = .horizontal
    row.distribution = .fill
    row.alignment = .centerY
    row.spacing = 8
    row.setCustomSpacing(4, after: hand)
    row.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 12)
    row.translatesAutoresizingMaskIntoConstraints = false
    addSubview(row)
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 28),
      icon.heightAnchor.constraint(equalToConstant: 28),
      heightAnchor.constraint(equalToConstant: Self.height),
      row.leadingAnchor.constraint(equalTo: leadingAnchor),
      row.trailingAnchor.constraint(equalTo: trailingAnchor),
      row.topAnchor.constraint(equalTo: topAnchor),
      row.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  // Drawn rather than set on the layer, so the drag image's snapshot includes the bar's fill.
  override func draw(_ dirtyRect: NSRect) {
    let shape = NSBezierPath(
      roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: Self.radius, yRadius: Self.radius)
    NSColor.windowBackgroundColor.withAlphaComponent(0.85).setFill()
    shape.fill()
    NSColor.labelColor.withAlphaComponent(0.12).setStroke()
    shape.stroke()
  }

  override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }

  // The panel never activates Atd, so the first click already picks the card up.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    pressedAt = convert(event.locationInWindow, from: nil)
  }

  override func mouseDragged(with event: NSEvent) {
    guard !dragging, let pressedAt else { return }
    let point = convert(event.locationInWindow, from: nil)
    guard hypot(point.x - pressedAt.x, point.y - pressedAt.y) >= 3 else { return }
    dragging = true
    let item = NSDraggingItem(pasteboardWriter: AppBundleDragWriter(url: appURL))
    item.setDraggingFrame(bounds, contents: snapshot())
    let session = beginDraggingSession(with: [item], event: event, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = true
  }

  override func mouseUp(with event: NSEvent) { pressedAt = nil }

  func draggingSession(
    _ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    context == .outsideApplication ? [.copy, .link, .generic] : []
  }

  func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) {
    alphaValue = 0.35
  }

  func draggingSession(
    _ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation
  ) {
    alphaValue = 1
    dragging = false
    pressedAt = nil
  }

  /// The bar as it looks now, for the drag image.
  private func snapshot() -> NSImage {
    guard let rep = bitmapImageRepForCachingDisplay(in: bounds) else { return NSImage() }
    cacheDisplay(in: bounds, to: rep)
    let image = NSImage(size: bounds.size)
    image.addRepresentation(rep)
    return image
  }
}

/// The app bundle as a Finder-style file drag: System Settings' permission lists accept a drop
/// that offers the file URL together with the legacy filenames type.
private final class AppBundleDragWriter: NSObject, NSPasteboardWriting {
  private let url: URL
  private static let filenames = NSPasteboard.PasteboardType("NSFilenamesPboardType")

  init(url: URL) { self.url = url }

  func writableTypes(for pasteboard: NSPasteboard) -> [NSPasteboard.PasteboardType] {
    [.fileURL, .URL, Self.filenames, .string]
  }

  func pasteboardPropertyList(forType type: NSPasteboard.PasteboardType) -> Any? {
    switch type {
    case .fileURL, .URL: url.absoluteString
    case Self.filenames: [url.path]
    case .string: url.path
    default: nil
    }
  }
}
