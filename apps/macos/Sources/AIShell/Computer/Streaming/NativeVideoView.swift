import AppKit
import QuartzCore

/// Native presentation of the newest admitted IOSurface. The display clock coalesces capture
/// updates; no pixel conversion, encoding or JavaScript delivery occurs on this path. Only the
/// fitted video is drawn: the area around it stays clear, so the container owns the letterbox.
final class NativeVideoView: NSView {
  struct Statistics {
    var presentedFrames = 0
    var skippedFrames = 0
    /// Time from the capture callback to admission for display, excluding unchanged idle time.
    var lastFrameAge: TimeInterval = 0
  }

  private final class DisplayTarget: NSObject {
    weak var view: NativeVideoView?

    init(view: NativeVideoView) { self.view = view }

    @objc func tick(_ link: CADisplayLink) { view?.present() }
  }

  private let frames: NativeCaptureFrames
  private let video = CALayer()
  private var displayed: NativeCaptureFrame?
  private var link: CADisplayLink?
  private var active = false
  private(set) var statistics = Statistics()

  init(frames: NativeCaptureFrames) {
    self.frames = frames
    super.init(frame: .zero)
    wantsLayer = true
    layer?.masksToBounds = true
    video.contentsGravity = .resize
    video.minificationFilter = .linear
    video.magnificationFilter = .linear
    layer?.addSublayer(video)
  }

  required init?(coder: NSCoder) { nil }

  isolated deinit { link?.invalidate() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func setActive(_ active: Bool) {
    self.active = active
    synchronizeClock()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    synchronizeClock()
  }

  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layoutVideo()
    CATransaction.commit()
  }

  private func synchronizeClock() {
    guard active, window != nil else {
      link?.invalidate()
      link = nil
      clear()
      return
    }
    if link == nil {
      let target = DisplayTarget(view: self)
      let link = displayLink(target: target, selector: #selector(DisplayTarget.tick(_:)))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
      link.add(to: .main, forMode: .common)
      self.link = link
    }
    present()
  }

  private func present() {
    guard active, let frame = frames.snapshot.frame else {
      clear()
      return
    }
    guard frame.sequence != displayed?.sequence else { return }
    if let previous = displayed {
      statistics.skippedFrames += max(0, frame.sequence - previous.sequence - 1)
    }
    statistics.presentedFrames += 1
    statistics.lastFrameAge = max(0, Date().timeIntervalSince(frame.capturedAt))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    video.contentsRect = frame.geometry.contentsRect
    video.contentsScale = frame.geometry.contentScale * frame.geometry.scaleFactor
    video.contents = frame.surface
    displayed = frame
    layoutVideo()
    CATransaction.commit()
  }

  private func clear() {
    guard displayed != nil else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    video.contents = nil
    displayed = nil
    CATransaction.commit()
  }

  private func layoutVideo() {
    guard let frame = displayed else { return }
    let size = frame.geometry.logicalSize
    let scale = min(bounds.width / size.width, bounds.height / size.height)
    let fitted = CGSize(width: size.width * scale, height: size.height * scale)
    video.frame = CGRect(
      x: bounds.midX - fitted.width / 2, y: bounds.midY - fitted.height / 2,
      width: fitted.width, height: fitted.height)
  }
}
