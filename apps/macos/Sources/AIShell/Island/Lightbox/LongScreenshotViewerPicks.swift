import AICore
import AppKit

/// The viewer's marks on the recognized text (``LongScreenshotTextModel``), over the image at the
/// screen's own scale whatever the zoom, as the capture editor's text mode marks its paragraphs
/// (Figma `App / Capture text pick`, `App / Capture text marquee`): every available paragraph for
/// a moment as text mode opens, the one under the pointer, the picked ones, a sweep over those a
/// command reads, a flash where a result lands, and the marquee with its count by the pointer.
///
/// It stands above the annotation canvas, so a pick shows over a translation's plate too. It
/// takes no clicks: the document under it does.
final class LongScreenshotViewerPicks: NSView {
  private let text: LongScreenshotTextModel
  /// The image's frame in this view, and image points per point of the image's own height.
  private var image = CGRect.zero
  private var scale: CGFloat = 1
  /// Where the marquee's count stands (this view's points); nil without a marquee.
  var badge: CGPoint? {
    didSet { if badge != oldValue { needsDisplay = true } }
  }
  /// Moves the reading sweep while a command reads.
  private var sweep: Timer?
  private var sweepPhase: CGFloat = 0

  /// The marks' alphas over the accent colour (the Figma `capture/text/*` variables).
  private enum Alpha {
    static let rest = 0.10
    static let hover = 0.16
    static let picked = 0.22
    static let edge = 0.40
    static let pickedEdge = 0.95
  }

  init(text: LongScreenshotTextModel) {
    self.text = text
    super.init(frame: .zero)
    wantsLayer = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  isolated deinit { sweep?.invalidate() }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// The image stands at `frame` (this view's points), `height` image points tall.
  func place(image frame: CGRect, height: CGFloat) {
    let scale = frame.height / max(height, 1)
    guard frame != image || scale != self.scale else { return }
    image = frame
    self.scale = scale
    needsDisplay = true
  }

  /// The model changed: the marks follow, and the sweep runs only while something reads.
  func refresh() {
    needsDisplay = true
    if text.reading.isEmpty {
      sweep?.invalidate()
      sweep = nil
    } else if sweep == nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.advanceSweep() }
      }
      RunLoop.main.add(timer, forMode: .common)
      sweep = timer
    }
  }

  /// One frame of the reading sweep.
  private func advanceSweep() {
    sweepPhase = (sweepPhase + 1.0 / 36).truncatingRemainder(dividingBy: 1)
    needsDisplay = true
  }

  /// `rect` (image points) in this view.
  private func place(_ rect: CGRect) -> CGRect {
    CGRect(
      x: image.minX + rect.minX * scale, y: image.minY + rect.minY * scale,
      width: rect.width * scale, height: rect.height * scale)
  }

  override func draw(_ dirtyRect: NSRect) {
    let accent = NSColor.controlAccentColor
    let picked = text.picks.picked
    for index in text.layout.indices {
      let state = mark(index, picked: picked)
      guard state != .none else { continue }
      let box = place(text.layout[index].box).insetBy(dx: -2, dy: -2)
      guard box.intersects(dirtyRect) else { continue }
      let path = NSBezierPath(roundedRect: box, xRadius: 4, yRadius: 4)
      accent.withAlphaComponent(state.fill).setFill()
      path.fill()
      if state == .reading { drawSweep(in: box, path: path, accent: accent) }
      accent.withAlphaComponent(state.edge).setStroke()
      path.lineWidth = 1
      path.stroke()
    }
    drawMarquee(accent)
  }

  private enum Mark: Equatable {
    case none, rest, hover, picked, reading

    var fill: CGFloat {
      switch self {
      case .none: 0
      case .rest, .reading: Alpha.rest
      case .hover: Alpha.hover
      case .picked: Alpha.picked
      }
    }

    var edge: CGFloat { self == .picked ? Alpha.pickedEdge : Alpha.edge }
  }

  /// What paragraph `index` shows: a landing or a pick strongest, then the reading sweep, the
  /// pointer's, and the opening flash over every available one.
  private func mark(_ index: Int, picked: Set<Int>) -> Mark {
    if text.landed.contains(index) || picked.contains(index) { return .picked }
    if text.reading.contains(index) { return .reading }
    if text.hovered == index { return .hover }
    if text.flashing, text.available.contains(index) { return .rest }
    return .none
  }

  /// A band of the accent colour crossing `box` again and again while its paragraph is read.
  private func drawSweep(in box: CGRect, path: NSBezierPath, accent: NSColor) {
    guard
      let gradient = NSGradient(colors: [
        accent.withAlphaComponent(0), accent.withAlphaComponent(0.28),
        accent.withAlphaComponent(0),
      ])
    else { return }
    let band = max(box.width * 0.4, 24)
    let x = box.minX - band + (box.width + band) * sweepPhase
    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    gradient.draw(in: CGRect(x: x, y: box.minY, width: band, height: box.height), angle: 0)
    NSGraphicsContext.restoreGraphicsState()
  }

  /// The marquee: a tinted box with a crisp edge, and the count of picks in a capsule by the
  /// pointer.
  private func drawMarquee(_ accent: NSColor) {
    guard let marquee = text.marquee else { return }
    let box = place(marquee)
    accent.withAlphaComponent(Alpha.rest).setFill()
    box.fill()
    accent.withAlphaComponent(Alpha.pickedEdge).setStroke()
    let edge = NSBezierPath(rect: box.insetBy(dx: 0.5, dy: 0.5))
    edge.lineWidth = 1
    edge.stroke()
    guard let badge else { return }
    let label = ShellStrings.shared.text(
      LongScreenshotTextStringKey.marqueeCount, count: text.picks.picked.count)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.white,
    ]
    let size = (label as NSString).size(withAttributes: attributes)
    let pill = CGRect(
      x: badge.x + 12, y: badge.y + 14, width: ceil(size.width) + 14, height: 20)
    accent.setFill()
    NSBezierPath(roundedRect: pill, xRadius: 10, yRadius: 10).fill()
    (label as NSString).draw(
      at: CGPoint(x: pill.minX + 7, y: pill.midY - size.height / 2), withAttributes: attributes)
  }
}
