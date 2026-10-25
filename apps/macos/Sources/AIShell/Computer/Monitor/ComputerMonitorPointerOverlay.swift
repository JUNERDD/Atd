import AICore
import AppKit
import QuartzCore

/// The agent pointer inside one monitor picture (plan §4.4): a transparent layer over the video
/// that draws the mark of the operation acting on the source's window, with the look of the
/// real-screen pointer (``PointerMark``). It lives in the picture, so it follows the picture
/// between its tile and the focus stage. Like the pixels, it never takes input.
///
/// The marks come from ``MonitorPointerFeed``, which holds each observation in screen points;
/// ``MonitorPointerFeed/link(_:key:windowId:)`` ties this picture's source to the operation whose
/// mark it shows. Where the mark lands is worked out here from the newest frame's attachments
/// (``MonitorPointerMapping``), so it sits on the pixels the person sees. It is cleared whenever
/// that mapping cannot be trusted: no frame, a frame of another window size, a window that moved
/// or resized, an expired observation. Only application sources draw one; a browser's viewport
/// position is not mapped in this round.
final class ComputerMonitorPointerOverlay: NSView, PointerCanvas {
  /// Where the marks go: the hosted layer itself, y up as ``PointerMark`` lays out, like the
  /// real-screen overlay's. AppKit flips a hosted layer's geometry when its view sits in a flipped
  /// one (the picture is), which keeps the view's own, unflipped orientation for what is under it.
  let canvas = CALayer()
  private let source: ComputerMonitorSource
  private let feed: MonitorPointerFeed
  private lazy var mark = PointerMark()
  private var shown: Shown?
  /// The observation whose click ripple was played, so a mark that comes back after a pause
  /// (a frame of another size, say) does not play it again.
  private var rippled: Int?

  /// What the canvas holds, to tell a new observation from the same one laid out again.
  private struct Shown {
    var sequence: Int
    var version: Int
    var target: CGRect
    var fading: Bool
  }

  init(source: ComputerMonitorSource, feed: MonitorPointerFeed = .shared) {
    self.source = source
    self.feed = feed
    super.init(frame: .zero)
    // Layer-hosting like the real-screen overlay, so AppKit leaves what is under the layer to this
    // view.
    layer = canvas
    wantsLayer = true
    autoresizingMask = [.width, .height]
    setAccessibilityElement(false)
    feed.observe(self) { [weak self] in self?.refresh() }
  }

  required init?(coder: NSCoder) { nil }

  isolated deinit { feed.stopObserving(self) }

  var displayID: CGDirectDisplayID { 0 }
  var scale: CGFloat { window?.backingScaleFactor ?? 2 }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// A new size lays the mark out again, also when the picture changes outside a layout pass (the
  /// focus transition's steps).
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    refresh()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    refresh()
  }

  override func viewDidHide() {
    super.viewDidHide()
    refresh()
  }

  override func viewDidUnhide() {
    super.viewDidUnhide()
    refresh()
  }

  /// A mark takes its pixel density from the canvas when it goes on it, so a new density starts
  /// it over.
  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    clear()
    refresh()
  }

  // MARK: Drawing

  private func refresh() {
    guard let placement = placement() else { return clear() }
    let (current, target) = placement
    let previous = shown
    if previous?.sequence != current.sequence {
      let glide =
        previous.map {
          PointerFramePolicy.glides(
            from: $0.target, to: target, reduceMotion: current.appearance.reduceMotion)
        } ?? false
      let ripple = current.clicked && rippled != current.sequence
      if ripple { rippled = current.sequence }
      mark.place(
        target: target, on: self, appearance: current.appearance, glide: glide,
        dispatched: ripple)
    } else {
      if previous?.target != target { mark.reposition(target: target, on: self) }
      if previous?.version != current.version { mark.apply(current.appearance) }
    }
    let wasFading = previous?.sequence == current.sequence && previous?.fading == true
    if current.fading, !wasFading { mark.fadeOut {} }
    shown = Shown(
      sequence: current.sequence, version: current.version, target: target, fading: current.fading)
  }

  /// The mark to draw and where on this picture, nil when there is none to trust. A source with a
  /// reason (starting, suspended, closed monitor) shows no frames, so it shows no mark; neither
  /// does a picture hidden behind the focus stage.
  private func placement() -> (MonitorPointerFeed.Mark, CGRect)? {
    guard source.kind == .application, source.reason == nil, !isHiddenOrHasHiddenAncestor,
      let link = feed.link(for: source), let current = feed.mark(for: link.key),
      current.windowId == link.windowId
    else { return nil }
    let geometry = source.frames?.snapshot.frame?.geometry
    let outcome = MonitorPointerMapping.map(
      current.snapshot, liveWindowFrame: feed.liveFrame(of: current.windowId),
      frame: geometry.map { MonitorFrameGeometry($0) }, picture: bounds.size, now: .now)
    guard case .target(let target) = outcome else { return nil }
    return (current, target)
  }

  private func clear() {
    guard shown != nil else { return }
    mark.remove()
    shown = nil
  }
}

extension MonitorFrameGeometry {
  /// The attachments behind a frame the monitor shows. The frame keeps its geometry as pixels,
  /// so the content rect is its pixel rect brought back to surface points; the two agree to the
  /// pixel rounding the frame already applied.
  fileprivate init(_ geometry: NativeCaptureGeometry) {
    let inverse = 1 / geometry.scaleFactor
    self.init(
      contentRect: geometry.pixelRect.applying(CGAffineTransform(scaleX: inverse, y: inverse)),
      contentScale: geometry.contentScale, scaleFactor: geometry.scaleFactor,
      bufferSize: geometry.bufferSize)
  }
}
