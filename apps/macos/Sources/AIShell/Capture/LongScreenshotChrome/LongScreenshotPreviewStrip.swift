import AICore
import AppKit

/// The preview beside the selection while a long screenshot is captured: a glass panel
/// (``NativeMaterialView`` with the shell's glass surface, ``GlassSurface``, as the capture bars
/// have it, blending within the overlay's window) ``LongScreenshotChromeLayout/stripWidth`` wide,
/// with ``padding`` inside, holding the stitched image so far (``LongScreenshotPreviewContent``)
/// and a caption under it. The strip takes presses on it, so they never reach the overlay under
/// it, and it never moves while the page scrolls.
final class LongScreenshotPreviewStrip: NSView {
  static let padding: CGFloat = 6
  /// The panel's corners, the prototype's (`.lp-strip`), the preset's `rounded-xl`.
  static let cornerRadius: CGFloat = 14

  private let material = NativeMaterialView(.capsule(.withinWindow))
  /// The glass's content: the surface fill, rounded as the glass is, with the preview on it.
  private let surface = NSView()
  private let content = LongScreenshotPreviewContent()

  override init(frame: NSRect) {
    super.init(frame: frame)
    content.setAccessibilityElement(false)
    surface.addSubview(content)
    GlassSurface.attach(material, content: surface)
    addSubview(material.view)
    setAccessibilityElement(true)
    setAccessibilityRole(.image)
    applyStrings()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The box the stitched image is drawn into, in points: the strip inside its padding, less the
  /// caption. The image the strip is given is drawn aspect-fit and top-aligned in it, so one
  /// rendered to fit this size at the display's backing scale shows at its own pixels.
  var previewSize: CGSize { LongScreenshotPreviewContent.previewBox(in: contentFrame.size).size }

  /// Reads the copy in the current shell language.
  func applyStrings() {
    setAccessibilityLabel(LongScreenshotChromeCopy.text(.strip))
    content.needsDisplay = true
  }

  /// Shows `progress` over `preview`, the stitched image scaled for the strip (nil before the
  /// first frame, which leaves the box empty).
  func show(_ progress: LongScreenshotProgress, preview: CGImage?) {
    let caption = LongScreenshotChromeCopy.caption(progress)
    content.show(progress, preview: preview, caption: caption)
    setAccessibilityHelp(caption)
  }

  /// Drops the preview image.
  func clear() {
    content.clear()
  }

  private var contentFrame: CGRect {
    CGRect(origin: .zero, size: bounds.size).insetBy(dx: Self.padding, dy: Self.padding)
  }

  override func layout() {
    super.layout()
    material.view.frame = bounds
    GlassSurface.shape(material, content: surface, cornerRadius: Self.cornerRadius)
    content.frame = contentFrame
  }

  // MARK: Presses

  /// The strip and nothing in it: a press anywhere on it is the strip's.
  override func hitTest(_ point: NSPoint) -> NSView? {
    super.hitTest(point) == nil ? nil : self
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// Taken here rather than passed up, so a press on the strip never reaches the overlay under it.
  override func mouseDown(with event: NSEvent) {}
  override func rightMouseDown(with event: NSEvent) {}

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole.passive.cursor)
  }
}

/// What the strip shows inside its padding, flipped (y down): the stitched image, aspect-fit to
/// the box over the caption and top-aligned with corners of ``imageRadius``, an accent box around
/// the part the selection shows now (``LongScreenshotProgress/view``), a dashed line in the
/// attention colour along the side where stitching lost the page
/// (``LongScreenshotProgress/lost``), and the caption: screens and height, or that stitching
/// waits.
final class LongScreenshotPreviewContent: NSView {
  static let captionGap: CGFloat = 4
  static let captionHeight: CGFloat = 18
  static let imageRadius: CGFloat = 4
  private static let captionFont = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)

  private var progress = LongScreenshotProgress(height: 0, screens: 0)
  private var preview: CGImage?
  private var caption = ""

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// The image's box in content of `size`: all of it above the caption.
  static func previewBox(in size: CGSize) -> CGRect {
    CGRect(
      x: 0, y: 0, width: max(0, size.width),
      height: max(0, size.height - captionGap - captionHeight))
  }

  func show(_ progress: LongScreenshotProgress, preview: CGImage?, caption: String) {
    guard progress != self.progress || preview !== self.preview || caption != self.caption
    else { return }
    self.progress = progress
    self.preview = preview
    self.caption = caption
    needsDisplay = true
  }

  func clear() {
    preview = nil
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    if let preview, let drawn = Self.fit(preview, in: Self.previewBox(in: bounds.size)) {
      drawImage(preview, in: drawn)
      drawView(in: drawn)
      drawLost(in: drawn)
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byTruncatingTail
    let font = Self.captionFont
    let height = ceil(font.ascender - font.descender + font.leading)
    let line = CGRect(
      x: 0, y: bounds.maxY - Self.captionHeight + (Self.captionHeight - height) / 2,
      width: bounds.width, height: height)
    let color =
      progress.lost == nil ? NSColor.secondaryLabelColor : LongScreenshotChromeCopy.attention
    NSAttributedString(
      string: caption,
      attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
    ).draw(in: line)
  }

  /// `image` aspect-fit in `box`, centred across it and at its top; nil for an empty image or box.
  private static func fit(_ image: CGImage, in box: CGRect) -> CGRect? {
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    guard width > 0, height > 0, box.width > 0, box.height > 0 else { return nil }
    let scale = min(box.width / width, box.height / height)
    let size = CGSize(width: width * scale, height: height * scale)
    return CGRect(
      origin: CGPoint(x: box.minX + (box.width - size.width) / 2, y: box.minY), size: size)
  }

  private func drawImage(_ image: CGImage, in rect: CGRect) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current?.imageInterpolation = .high
    NSBezierPath(roundedRect: rect, xRadius: Self.imageRadius, yRadius: Self.imageRadius).addClip()
    NSImage(cgImage: image, size: rect.size).draw(
      in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true,
      hints: nil)
    NSGraphicsContext.restoreGraphicsState()
  }

  /// The accent box around the rows the selection shows, mapped from image points to the drawn
  /// image and kept on it; at least 4 pt tall, so it stays visible on a very long image.
  private func drawView(in rect: CGRect) {
    guard let view = progress.view, progress.height > 0 else { return }
    let scale = rect.height / progress.height
    let height = min(rect.height, max(4, (view.upperBound - view.lowerBound) * scale))
    let top = min(max(rect.minY, rect.minY + view.lowerBound * scale), rect.maxY - height)
    let box = NSBezierPath(
      rect: CGRect(x: rect.minX, y: top, width: rect.width, height: height)
        .insetBy(dx: 0.75, dy: 0.75))
    box.lineWidth = 1.5
    NSColor.controlAccentColor.setStroke()
    box.stroke()
  }

  /// The dashed line along the image's bottom or top edge, where stitching waits.
  private func drawLost(in rect: CGRect) {
    guard let lost = progress.lost else { return }
    let y = lost == .down ? rect.maxY - 1 : rect.minY + 1
    let line = NSBezierPath()
    line.move(to: CGPoint(x: rect.minX, y: y))
    line.line(to: CGPoint(x: rect.maxX, y: y))
    line.lineWidth = 2
    line.setLineDash([3, 2], count: 2, phase: 0)
    LongScreenshotChromeCopy.attention.setStroke()
    line.stroke()
  }
}
