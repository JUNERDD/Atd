import AICore
import AppKit
import CoreGraphics
import Testing

@testable import AIShell

/// Exercises the actual capture session with generated pixels and no screen or AX reads.
@MainActor
final class CaptureLifecycleFixture {
  let session: CaptureSession
  let window: NSWindow
  let overlay: CaptureLifecycleWeak<CaptureOverlayView>
  let image: CaptureLifecycleWeak<CGImage>

  init(pressing: Bool = false) throws {
    _ = NSApplication.shared
    let screen = try #require(NSScreen.screens.first)
    let bounds = CGRect(x: 0, y: 0, width: 64, height: 64)
    let context = try #require(
      CGContext(
        data: nil, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 64 * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(gray: 0.5, alpha: 1))
    context.fill(bounds)
    let pixels = try #require(context.makeImage())
    image = CaptureLifecycleWeak(pixels)
    session = CaptureSession(
      targeting: CaptureLifecycleTargeting(), offersTrustRequest: false,
      regions: CaptureRegionMemory(),
      makeEditor: { fatalError("Lifecycle checks must never create an annotation editor") })
    session.arrange(quartzBounds: bounds)
    session.add(FrozenDisplay(displayID: 1, quartzFrame: bounds, image: pixels), on: screen)
    let view = try #require(session.overlays.first)
    window = try #require(view.window)
    #expect(window.makeFirstResponder(view))
    // add uses the production presentation path. Hide synchronously before yielding or drawing;
    // no activate(), key-window change, mouse event, screen capture or pixel read is performed.
    window.orderOut(nil)
    overlay = CaptureLifecycleWeak(view)
    if pressing { session.phase = .pressing(view, start: .zero) }
  }

  func dispose() {
    session.cancel()
    // Test cleanup also handles the deliberately failing baseline.
    session.phase = .idle
    window.contentView = nil
    window.close()
  }

  static func settle() async throws {
    CATransaction.flush()
    try await Task.sleep(for: .milliseconds(50))
  }
}

private nonisolated struct CaptureLifecycleTargeting: ElementTargeting {
  func begin(windows: [CaptureWindow]) async -> ElementDetection { .windowsOnly }
  func targets(at point: CGPoint) async -> [CGRect] { [] }
  func describe(at point: CGPoint, frame: CGRect) async -> ElementDescription? { nil }
  func end() async {}
}

@MainActor
final class CaptureLifecycleWeak<Object: AnyObject> {
  weak var value: Object?
  init(_ value: Object) { self.value = value }
}
