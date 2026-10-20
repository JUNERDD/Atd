import AICore
import AppKit

/// A source's picture: a continuously rounded, clipped area on a translucent neutral fill
/// (`systemFill`, about 10% black in light and 10% white in dark) through which the window's
/// surface shows, with the newest frame fitted inside it (native frames through ``NativeVideoView``,
/// browser frames as an image) and, while no frames show, the status layout over it
/// (``ComputerMonitorStatusView``). The frames themselves stay opaque; only the area they leave
/// (letterboxing, status, empty) is translucent. A hairline separator border outlines the area.
///
/// The picture moves as one view between its tile and the focus stage, and its owner lays it out
/// on every step of that move, so the video is fitted to each intermediate frame. Pixels never
/// take input: only the status action does, and every other press belongs to the tile under it.
final class ComputerMonitorPicture: NSView {
  private let source: ComputerMonitorSource
  private let imageLayer = CALayer()
  private let status = ComputerMonitorStatusView()
  private var native: NativeVideoView?
  private var attached: NativeCaptureFrames?
  private var active = false

  init(source: ComputerMonitorSource) {
    self.source = source
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = ComputerMonitorLayout.cornerRadius
    layer?.cornerCurve = .continuous
    layer?.masksToBounds = true
    imageLayer.contentsGravity = .resizeAspect
    layer?.addSublayer(imageLayer)
    addSubview(status)
    // The agent pointer lives in the picture, so it follows it between its tile and the stage.
    addSubview(ComputerMonitorPointerOverlay(source: source))
    updateColors()
  }

  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { true }

  /// Whether frames are drawn; an inactive picture is only its backing and its status.
  func setActive(_ active: Bool) {
    self.active = active
    native?.setActive(active)
    refresh()
  }

  /// Follows the source: its native frame store, its newest browser image and its reason.
  func refresh() {
    if attached !== source.frames {
      native?.setActive(false)
      native?.removeFromSuperview()
      attached = source.frames
      native = source.frames.map(NativeVideoView.init(frames:))
      if let native {
        addSubview(native, positioned: .below, relativeTo: status)
        native.frame = bounds
        native.setActive(active)
      }
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    imageLayer.contents = active ? source.image : nil
    CATransaction.commit()
    status.show(source.reason, animating: active)
  }

  func localize() { status.localize() }

  /// A new size lays the video out again, also when the frame changes outside a layout pass (the
  /// focus transition's steps).
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    if let native {
      native.frame = bounds
      native.needsLayout = true
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    imageLayer.frame = bounds
    CATransaction.commit()
    status.frame = bounds
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit is NSButton ? hit : nil
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateColors()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    updateColors()
  }

  /// The backing fill and one device pixel of the separator color, which Increase Contrast
  /// strengthens, resolved in the picture's appearance because a layer keeps no dynamic color.
  private func updateColors() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      layer?.backgroundColor = NSColor.systemFill.cgColor
      layer?.borderColor = NSColor.separatorColor.cgColor
    }
    layer?.borderWidth = 1 / (window?.backingScaleFactor ?? 2)
  }
}
