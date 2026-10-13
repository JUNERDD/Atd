import AppKit
import Testing

@testable import AIShell

/// The typing trace's overlay in a real window: its layers must land on the text Accessibility
/// reported once AppKit shows the window, which resets a hosted layer's `isGeometryFlipped` and
/// so turned an earlier version of the trace upside down.
@MainActor
@Suite("Insertion trace overlay", .enabled(if: !NSScreen.screens.isEmpty))
struct InsertionTraceOverlayTests {
  @Test("The glow sits at the end of the last character and the wash on the chunk")
  func placement() async throws {
    let primary = try #require(NSScreen.screens.first).frame.height
    // A text field near the top-left of the primary display, in Quartz points, and a line of
    // text in it.
    let field = CGRect(x: 200, y: 180, width: 400, height: 120)
    let anchor = CGRect(x: 300, y: 200, width: 8, height: 18)
    let wash = CGRect(x: 260, y: 200, width: 48, height: 18)
    let overlay = InsertionTraceOverlay()
    overlay.show(anchor: anchor, wash: [wash], field: field)
    defer { overlay.finish() }
    let window = try #require(overlay.window)
    // Let AppKit show the window, which is when it touches the hosted layer.
    try await Task.sleep(for: .milliseconds(100))

    let view = try #require(window.contentView)
    let root = try #require(view.layer)
    let stage = try #require(root.sublayers?.first)
    func onScreen(_ layer: CALayer) -> CGRect {
      let local = view.convertFromLayer(stage.convert(layer.frame, to: root))
      let cocoa = window.convertToScreen(local)
      return CGRect(
        x: cocoa.minX, y: primary - cocoa.maxY, width: cocoa.width, height: cocoa.height)
    }
    let layers = stage.sublayers ?? []
    let glow = try #require(layers.first { !($0.sublayers ?? []).isEmpty })
    let washed = try #require(layers.first { ($0.sublayers ?? []).isEmpty })

    let glowRect = onScreen(glow)
    #expect(abs(glowRect.midX - anchor.maxX) < 0.5)
    #expect(abs(glowRect.minY - anchor.minY) < 0.5)
    #expect(abs(glowRect.height - anchor.height) < 0.5)
    let washRect = onScreen(washed)
    #expect(abs(washRect.minX - wash.minX) < 0.5)
    #expect(abs(washRect.minY - wash.minY) < 0.5)
    #expect(abs(washRect.width - wash.width) < 0.5)
  }

  @Test("Under reduced motion the wash shows and the moving glow does not")
  func reducedMotion() async throws {
    let field = CGRect(x: 200, y: 180, width: 400, height: 120)
    let anchor = CGRect(x: 300, y: 200, width: 8, height: 18)
    let overlay = InsertionTraceOverlay(reducesMotion: true)
    // The glow alone has nothing to show: no window.
    overlay.show(anchor: anchor, wash: [], field: field)
    #expect(overlay.window == nil)

    overlay.show(
      anchor: anchor, wash: [CGRect(x: 260, y: 200, width: 48, height: 18)], field: field)
    defer { overlay.finish() }
    let window = try #require(overlay.window)
    try await Task.sleep(for: .milliseconds(100))
    let stage = try #require(window.contentView?.layer?.sublayers?.first)
    let layers = stage.sublayers ?? []
    let glow = try #require(layers.first { !($0.sublayers ?? []).isEmpty })
    #expect(glow.opacity == 0)
    #expect(glow.animationKeys() == nil)
    #expect(layers.contains { ($0.sublayers ?? []).isEmpty })
  }
}
