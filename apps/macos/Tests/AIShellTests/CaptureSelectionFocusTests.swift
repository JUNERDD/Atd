import AICore
import AppKit
import CoreGraphics
import Testing

@testable import AIShell

@MainActor
@Suite("Capture selection drag and toolbar focus retention", .serialized)
struct CaptureSelectionFocusTests {
  @Test(
    "Dragging selection interior, handles, and toolbar keeps canvas firstResponder for shortcuts",
    .enabled(if: !NSScreen.screens.isEmpty))
  func dragsPreserveCanvasFirstResponderAndShortcuts() async throws {
    _ = NSApplication.shared
    let screen = try #require(NSScreen.screens.first)
    let bounds = CGRect(origin: .zero, size: screen.frame.size)
    let ctx = try #require(
      CGContext(
        data: nil, width: max(1, Int(bounds.width)), height: max(1, Int(bounds.height)),
        bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    let pixels = try #require(ctx.makeImage())
    let suite = "capture-focus-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }

    var capturedEditor: AnnotationEditor?
    let session = CaptureSession(
      targeting: FocusStubTargeting(), offersTrustRequest: false,
      regions: CaptureRegionMemory(),
      makeEditor: {
        let editor = AnnotationEditor(defaults: defaults)
        capturedEditor = editor
        return editor
      })
    session.arrange(quartzBounds: bounds)
    session.add(FrozenDisplay(displayID: 1, quartzFrame: bounds, image: pixels), on: screen)
    let overlay = try #require(session.overlays.first)
    let window = try #require(overlay.window)
    (window.level, window.alphaValue, window.ignoresMouseEvents) = (.normal, 0, true)
    window.orderBack(nil)
    defer {
      window.orderOut(nil)
      session.cancel()
      window.contentView = nil
      window.close()
    }

    session.hasKeyboard = true
    session.beginInteractive()
    session.commit(CGRect(x: 40, y: 40, width: 160, height: 120))
    overlay.layoutSubtreeIfNeeded()

    let editor = try #require(capturedEditor)
    let canvas = try #require(overlay.annotationHost.canvas)
    #expect(window.firstResponder === canvas && !overlay.acceptsFirstResponder)
    #expect(window.makeFirstResponder(overlay) && window.firstResponder === canvas)
    let slider = AnnotationSizeSlider()
    #expect(slider.refusesFirstResponder && !slider.acceptsFirstResponder)
    let toolButton = try #require(findView(AnnotationToolbarButton.self, in: editor.toolbar))
    #expect(toolButton.refusesFirstResponder && !toolButton.acceptsFirstResponder)

    // Drag selection interior (no active tool) via NSWindow.sendEvent, then press "r".
    sendDrag(from: CGPoint(x: 120, y: 100), to: CGPoint(x: 170, y: 130), on: overlay, in: window)
    let moved = try #require(selectedRect(of: session))
    #expect(moved.origin.x > 40 && moved.origin.y > 40 && window.firstResponder === canvas)
    try sendKey("r", keyCode: 15, to: window)
    #expect(editor.interaction.tool == .rectangle)

    // With .rectangle active, drag .bottomRight handle via NSWindow.sendEvent, then press "o".
    let handle = SelectionHandle.bottomRight.point(on: moved)
    sendDrag(
      from: handle, to: CGPoint(x: handle.x + 40, y: handle.y + 30), on: overlay, in: window)
    let resized = try #require(selectedRect(of: session))
    #expect(resized.width > moved.width && resized.height > moved.height)
    #expect(window.firstResponder === canvas)
    try sendKey("o", keyCode: 31, to: window)
    #expect(editor.interaction.tool == .ellipse)

    // Drag floating toolbar grip via NSWindow.sendEvent, then press "t".
    overlay.layoutSubtreeIfNeeded()
    let grip = try #require(findView(AnnotationBarGrip.self, in: editor.toolbar))
    let gripPt = grip.convert(CGPoint(x: grip.bounds.midX, y: grip.bounds.midY), to: overlay)
    sendDrag(
      from: gripPt, to: CGPoint(x: gripPt.x + 24, y: gripPt.y + 12), on: overlay, in: window)
    #expect(editor.movedOrigin != nil && window.firstResponder === canvas)
    try sendKey("t", keyCode: 17, to: window)
    #expect(editor.interaction.tool == .text)

    // Dropping the tool and right-clicking returns to idle and restores overlay firstResponder.
    editor.choose(nil)
    session.overlayRightClicked(overlay)
    #expect(overlay.annotationHost.canvas == nil && overlay.acceptsFirstResponder)
    #expect(window.firstResponder === overlay)
  }

  private func selectedRect(of session: CaptureSession) -> CGRect? {
    if case .selected(let rect) = session.phase { rect } else { nil }
  }

  private func sendDrag(from start: CGPoint, to end: CGPoint, on view: NSView, in win: NSWindow) {
    for (type, point, pressure) in [
      (NSEvent.EventType.leftMouseDown, start, Float(1)),
      (.leftMouseDragged, end, 1),
      (.leftMouseUp, end, 0),
    ] {
      guard
        let ev = NSEvent.mouseEvent(
          with: type, location: view.convert(point, to: nil), modifierFlags: [],
          timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber,
          context: nil, eventNumber: 0, clickCount: 1, pressure: pressure)
      else { continue }
      win.sendEvent(ev)
    }
  }

  private func sendKey(_ chars: String, keyCode: UInt16, to window: NSWindow) throws {
    let event = try #require(
      NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
        context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false,
        keyCode: keyCode))
    try #require(window.firstResponder as? NSView).keyDown(with: event)
  }

  private func findView<T: NSView>(_ type: T.Type, in root: NSView) -> T? {
    if let match = root as? T { return match }
    return root.subviews.lazy.compactMap { findView(type, in: $0) }.first
  }
}

private nonisolated struct FocusStubTargeting: ElementTargeting {
  func begin(windows: [CaptureWindow]) async -> ElementDetection { .windowsOnly }
  func targets(at point: CGPoint) async -> [CGRect] { [] }
  func describe(at point: CGPoint, frame: CGRect) async -> ElementDescription? { nil }
  func scrollArea(around selection: CGRect) async -> LongScreenshotScrollArea? { nil }
  func end() async {}
}
