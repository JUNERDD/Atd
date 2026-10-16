import AppKit

/// Keeps a page window's content off the outermost point of its Liquid Glass, where the glass
/// draws its light rim. The page paints the panel fill (`--ata-surface-panel`) edge to edge, and
/// over the rim that fill dimmed it, so only the dark line macOS draws outside a dark window stayed
/// visible and the window read as framed in black. The content is clipped to the window's own
/// outline inset by a point: the window's corner radius less the inset, on the same continuous
/// curve, so the rim shows unbroken around the corners.
///
/// The glass does not follow the window's corners (its own `cornerRadius` stays at 8), so the
/// radius is the window's (``NSWindow/outlineCornerRadius``); without it the content stays
/// unclipped, as before. macOS 15 has no rim to reveal and draws a hairline instead
/// (``MaterialEffectView/windowEdged``).
@available(macOS 26, *)
final class GlassRimClipView: NSView {
  private static let inset: CGFloat = 1
  private let clip = CALayer()

  init(content: NSView) {
    super.init(frame: .zero)
    wantsLayer = true
    clip.backgroundColor = NSColor.black.cgColor
    clip.cornerCurve = .continuous
    content.frame = bounds
    content.autoresizingMask = [.width, .height]
    addSubview(content)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    updateClip()
  }

  override func layout() {
    super.layout()
    updateClip()
  }

  /// Follows the window's size on every layout pass, without the layer's implicit animation, so
  /// the clip never trails a live resize.
  private func updateClip() {
    guard let radius = window?.outlineCornerRadius else {
      layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    clip.frame = bounds.insetBy(dx: Self.inset, dy: Self.inset)
    clip.cornerRadius = max(radius - Self.inset, 0)
    layer?.mask = clip
    CATransaction.commit()
  }
}

extension NSWindow {
  /// The radius the system rounds this titled window's corners to, on a continuous curve: 26pt
  /// for a toolbar window on macOS 26. AppKit keeps it private (`_cornerRadius`), so this is nil
  /// once AppKit stops answering it, and the page windows' edges (``GlassRimClipView``,
  /// ``MaterialEffectView/windowEdged``) then fall back to drawing nothing of their own.
  var outlineCornerRadius: CGFloat? {
    let key = "_cornerRadius"
    guard responds(to: NSSelectorFromString(key)) else { return nil }
    return value(forKey: key) as? CGFloat
  }
}
