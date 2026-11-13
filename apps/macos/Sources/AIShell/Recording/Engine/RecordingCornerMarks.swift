import AICore
import AppKit
import QuartzCore

/// The windows a recording puts on screen: borderless, non-activating, click-through, on every
/// Space and above ordinary windows, so the recorded apps keep the pointer and the keyboard.
enum RecordingOverlayWindow {
  /// Just below the Island (`.statusBar`), which stays reachable over them.
  static let level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue - 1)

  static func make(level: NSWindow.Level = level) -> NSPanel {
    let window = NSPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = level
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.animationBehavior = .none
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle,
    ]
    return window
  }

  /// A recorded region (Quartz points) in Cocoa screen coordinates, for a window frame.
  static func cocoaFrame(_ quartz: CGRect) -> CGRect {
    CaptureCoordinates.flip(quartz, primaryHeight: NSScreen.screens.first?.frame.height ?? 0)
  }
}

/// The four corner marks around the region being recorded (decision R1): white L-shapes just
/// outside it, dimmed while paused. The recording's filter leaves Atd's windows out, so they are
/// never in the video, and they take no clicks.
final class RecordingCornerMarks {
  private static let arm: CGFloat = 18
  private static let line: CGFloat = 2
  /// How far outside the region the marks sit.
  private static let outset: CGFloat = 3

  private var window: NSPanel?
  private let marks = CAShapeLayer()

  /// Shows the marks around `region` (Quartz points), or moves them there.
  func show(around region: CGRect) {
    let frame = region.insetBy(dx: -Self.outset - Self.line, dy: -Self.outset - Self.line)
    let window = window ?? makeWindow()
    self.window = window
    window.setFrame(RecordingOverlayWindow.cocoaFrame(frame), display: false)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    marks.frame = CGRect(origin: .zero, size: frame.size)
    marks.path = Self.path(in: marks.bounds.insetBy(dx: Self.line / 2, dy: Self.line / 2))
    CATransaction.commit()
    window.orderFrontRegardless()
  }

  /// Dims the marks while the recording is paused.
  func setPaused(_ paused: Bool) {
    marks.strokeColor = NSColor.white.withAlphaComponent(paused ? 0.55 : 1).cgColor
  }

  func hide() {
    window?.orderOut(nil)
  }

  private func makeWindow() -> NSPanel {
    let window = RecordingOverlayWindow.make()
    let view = NSView()
    view.wantsLayer = true
    marks.fillColor = nil
    marks.lineWidth = Self.line
    marks.lineCap = .square
    marks.strokeColor = NSColor.white.cgColor
    marks.shadowColor = NSColor.black.cgColor
    marks.shadowOpacity = 0.7
    marks.shadowRadius = 1
    marks.shadowOffset = .zero
    view.layer?.addSublayer(marks)
    window.contentView = view
    return window
  }

  /// The four L-shapes along `rect`'s corners.
  private static func path(in rect: CGRect) -> CGPath {
    let path = CGMutablePath()
    let corners: [(CGPoint, CGFloat, CGFloat)] = [
      (CGPoint(x: rect.minX, y: rect.minY), 1, 1), (CGPoint(x: rect.maxX, y: rect.minY), -1, 1),
      (CGPoint(x: rect.minX, y: rect.maxY), 1, -1), (CGPoint(x: rect.maxX, y: rect.maxY), -1, -1),
    ]
    for (corner, dx, dy) in corners {
      path.move(to: CGPoint(x: corner.x, y: corner.y + dy * arm))
      path.addLine(to: corner)
      path.addLine(to: CGPoint(x: corner.x + dx * arm, y: corner.y))
    }
    return path
  }
}
