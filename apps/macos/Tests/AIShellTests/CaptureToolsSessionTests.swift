import AICore
import AppKit
import CoreGraphics
import Testing

@testable import AIShell

@MainActor
@Suite("Capture tools session, pins, badge hit-testing, and loupe", .serialized)
struct CaptureToolsSessionTests {
  @Test(
    "Pin finishes capture session with .pinned and releases full-screen pixels",
    .enabled(if: !NSScreen.screens.isEmpty))
  func pinEndsSessionAndReleasesPixels() async throws {
    _ = NSApplication.shared
    let screen = try #require(NSScreen.screens.first)
    let bounds = CGRect(x: 0, y: 0, width: 160, height: 120)

    let result = try await runPinSession(on: screen, bounds: bounds)
    try await CaptureLifecycleFixture.settle()

    guard case .pinned(let confirmation) = result.outcome else {
      Issue.record("Expected .pinned outcome")
      return
    }
    #expect(confirmation.selection.size == CGSize(width: 80, height: 60))
    #expect(result.isFinished)
    #expect(result.overlaysEmpty)
    #expect(result.hadPinCallback)
    #expect(result.weakOverlay.value == nil)
    #expect(result.weakPixels.value == nil)
  }

  private func runPinSession(on screen: NSScreen, bounds: CGRect) async throws -> (
    outcome: CaptureSession.Outcome, isFinished: Bool, overlaysEmpty: Bool,
    hadPinCallback: Bool, weakOverlay: CaptureLifecycleWeak<CaptureOverlayView>,
    weakPixels: CaptureLifecycleWeak<CGImage>
  ) {
    let pixels = try makeSolidImage(size: bounds.size, red: 0.2, green: 0.4, blue: 0.8)
    let weakPixels = CaptureLifecycleWeak(pixels)
    let suite = "capture-pin-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }

    var createdEditor: AnnotationEditor?
    let session = CaptureSession(
      targeting: StubCaptureTargeting(), offersTrustRequest: false,
      regions: CaptureRegionMemory(),
      makeEditor: {
        let editor = AnnotationEditor(defaults: defaults)
        createdEditor = editor
        return editor
      })
    session.arrange(quartzBounds: bounds)
    session.add(FrozenDisplay(displayID: 1, quartzFrame: bounds, image: pixels), on: screen)
    let overlay = try #require(session.overlays.first)
    let window = try #require(overlay.window)
    window.orderOut(nil)
    let weakOverlay = CaptureLifecycleWeak(overlay)
    defer {
      session.cancel()
      window.contentView = nil
      window.close()
    }

    session.commit(CGRect(x: 20, y: 15, width: 80, height: 60))
    let hadPinCallback = createdEditor?.onPin != nil
    createdEditor?.onPin?()

    let outcome = await session.run()
    return (
      outcome, session.isFinished, session.overlays.isEmpty, hadPinCallback, weakOverlay,
      weakPixels
    )
  }

  @Test(
    "Size badge hit-testing works inside selection and yields to popovers/text editing",
    .enabled(if: !NSScreen.screens.isEmpty))
  func badgeHitTestingAndGuards() async throws {
    _ = NSApplication.shared
    let screen = try #require(NSScreen.screens.first)
    let bounds = CGRect(x: 0, y: 0, width: 400, height: 300)
    let pixels = try makeSolidImage(size: bounds.size, red: 0.1, green: 0.2, blue: 0.3)
    let suite = "capture-badge-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }

    var capturedEditor: AnnotationEditor?
    let session = CaptureSession(
      targeting: StubCaptureTargeting(), offersTrustRequest: false,
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
    window.orderOut(nil)
    defer {
      session.cancel()
      window.contentView = nil
      window.close()
    }

    session.beginInteractive()
    // Full-screen selection forces the size badge inside the selection interior.
    session.commit(bounds)
    let editor = try #require(capturedEditor)
    let badgeFrame = try #require(overlay.sizeLabelFrame)
    let badgeCenter = CGPoint(x: badgeFrame.midX, y: badgeFrame.midY)
    let hitPoint = overlay.convert(badgeCenter, to: overlay.superview)

    #expect(overlay.isInteractiveBadge(at: badgeCenter))
    #expect(overlay.hitTest(hitPoint) is CaptureChromeView)

    // With an active drawing tool over empty canvas, badge clicks still reach chrome.
    editor.choose(.rectangle)
    #expect(overlay.isInteractiveBadge(at: badgeCenter))
    #expect(overlay.hitTest(hitPoint) is CaptureChromeView)

    // An open eyedropper or text edit disables interactive badge hijacking.
    editor.styleCoordinator.setEyedropper(true)
    #expect(!editor.allowsBadgeInteraction)
    #expect(!overlay.isInteractiveBadge(at: badgeCenter))
    editor.styleCoordinator.setEyedropper(false)

    let canvas = try #require(editor.canvases.first)
    editor.textEditor.begin(
      at: CGPoint(x: 120, y: 120), editing: nil, style: AnnotationStyle(), in: canvas)
    #expect(!editor.allowsBadgeInteraction)
    #expect(!overlay.isInteractiveBadge(at: badgeCenter))

    let textView = try #require(canvas.subviews.first { $0 is NSTextView } as? NSTextView)
    textView.setMarkedText(
      "b'b'sa'sa",
      selectedRange: NSRange(location: 9, length: 0),
      replacementRange: NSRange(location: NSNotFound, length: 0))
    #expect((editor.textEditor.frame?.width ?? 0) > 30)

    // Mid-composition restyle preserves IME attributes and keeps marked state active.
    textView.textStorage?.addAttribute(
      .underlineStyle, value: NSUnderlineStyle.single.rawValue,
      range: NSRange(location: 0, length: 9))
    editor.textEditor.setStyle(AnnotationStyle(fontSize: 22))
    #expect(textView.hasMarkedText())
    #expect(textView.textStorage?.attribute(.underlineStyle, at: 0, effectiveRange: nil) != nil)

    textView.setMarkedText(
      "",
      selectedRange: NSRange(location: 0, length: 0),
      replacementRange: NSRange(location: NSNotFound, length: 0))
    #expect((editor.textEditor.frame?.width ?? .infinity) < 16)
    editor.textEditor.cancel()

    session.applyAspectPreset(.r16x9)
    #expect(session.aspectPreset == .r16x9)
  }

  @Test("CapturePinnedWindow copy, zoom, border, shadow, opacity clamping, and idempotent close")
  func pinnedWindowActions() throws {
    _ = NSApplication.shared
    let suite = "capture-pin-window-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }

    let size = CGSize(width: 100, height: 80)
    let cgImage = try makeSolidImage(size: size, red: 0.9, green: 0.2, blue: 0.2)
    let image = NSImage(cgImage: cgImage, size: size)
    var copyCount = 0
    var closedWindows: [CapturePinnedWindow] = []
    let pin = CapturePinnedWindow(
      image: image, logicalSize: size, origin: CGPoint(x: 120, y: 140), defaults: defaults,
      onCopy: {
        copyCount += 1
        return true
      }, onClose: { closedWindows.append($0) })
    defer { pin.closePin() }

    #expect(pin.styleMask.contains(.nonactivatingPanel))
    #expect(!pin.hidesOnDeactivate)
    #expect(pin.becomesKeyOnlyIfNeeded)
    #expect(!pin.canBecomeMain)
    #expect(pin.collectionBehavior.contains(.ignoresCycle))
    #expect(pin.canBecomeKey)
    #expect(pin.isBorderEnabled && pin.isShadowEnabled && pin.hasShadow)
    #expect(pin.pinScale == 1.0 && !pin.isZoomedScale)

    pin.performCopy()
    #expect(copyCount == 1)

    pin.adjustOpacity(by: -2.0)
    #expect(pin.pinOpacity == 0.25)
    pin.adjustOpacity(by: 0.5)
    #expect(pin.pinOpacity == 0.75)

    pin.setPinScale(2.0, showHud: false)
    #expect(pin.pinScale == 2.0)
    #expect(pin.isZoomedScale)
    #expect(pin.frame.size == CGSize(width: 200, height: 160))

    pin.setPinScale(0.1, showHud: false)
    #expect(pin.frame.size == CGSize(width: 60, height: 48))

    pin.setPinScale(1.0, showHud: false)
    #expect(!pin.isZoomedScale)
    #expect(pin.frame.size == CGSize(width: 100, height: 80))

    pin.toggleZoom()
    #expect(pin.isZoomedScale)
    #expect(pin.frame.size == CGSize(width: 150, height: 120))
    pin.toggleZoom()
    #expect(!pin.isZoomedScale)
    #expect(pin.frame.size == CGSize(width: 100, height: 80))

    let content = try #require(pin.contentView as? PinnedContentView)
    #expect(content.controlsBar.actionButtons.allSatisfy { !$0.followsPointer })
    #expect(content.resizeHandle(at: CGPoint(x: 96, y: 76)) == .topRight)
    #expect(content.resizeHandle(at: CGPoint(x: 4, y: 4)) == .bottomLeft)
    #expect(content.resizeHandle(at: CGPoint(x: 96, y: 40)) == .right)
    #expect(content.resizeHandle(at: CGPoint(x: 50, y: 76)) == .top)
    #expect(content.resizeHandle(at: CGPoint(x: 50, y: 40)) == nil)
    let base = pin.frame
    func resize(_ handle: SelectionHandle, _ dx: CGFloat, _ dy: CGFloat, centered: Bool = false) {
      pin.applyPinResize(
        from: base, initialScale: 1.0, handle: handle, delta: CGVector(dx: dx, dy: dy),
        centered: centered, showHud: false)
    }
    resize(.topRight, 50, 40)
    #expect(pin.frame == NSRect(x: base.minX, y: base.minY, width: 150, height: 120))
    resize(.bottomLeft, -50, -40)
    #expect(pin.frame == NSRect(x: base.maxX - 150, y: base.maxY - 120, width: 150, height: 120))
    resize(.right, 25, 0, centered: true)
    #expect(pin.frame == NSRect(x: base.midX - 75, y: base.midY - 60, width: 150, height: 120))
    pin.setPinScale(1.0, showHud: false)

    pin.toggleBorder()
    pin.toggleShadow()
    #expect(!pin.isBorderEnabled)
    #expect(!pin.isShadowEnabled)
    #expect(!pin.hasShadow)

    let restoredPin = CapturePinnedWindow(
      image: image, logicalSize: size, origin: CGPoint(x: 120, y: 140), defaults: defaults,
      onCopy: { true }, onClose: { _ in })
    defer { restoredPin.closePin() }
    #expect(!restoredPin.isBorderEnabled && !restoredPin.isShadowEnabled && !restoredPin.hasShadow)

    pin.closePin()
    pin.closePin()
    #expect(closedWindows.count == 1)
    #expect(!pin.canBecomeKey)
    #expect(!pin.isVisible)
  }

  @Test("Loupe copies sampled sRGB color as HEX and rgb() via copy callback")
  func loupeCopiesHexAndRgb() throws {
    _ = NSApplication.shared
    let cgImage = try makeSolidImage(size: CGSize(width: 24, height: 24), red: 1, green: 0, blue: 0)
    let loupe = LoupeView(image: cgImage, scale: 1)
    var copiedValues: [String] = []
    loupe.onCopyText = { value in
      copiedValues.append(value)
      return true
    }
    loupe.update(at: CGPoint(x: 12, y: 12), quartz: CGPoint(x: 12, y: 12))

    let hex = loupe.copyColor(asRGB: false)
    let rgb = loupe.copyColor(asRGB: true)
    #expect(hex == "#FF0000")
    #expect(rgb == "rgb(255, 0, 0)")
    #expect(copiedValues == ["#FF0000", "rgb(255, 0, 0)"])
  }

  @Test("AnnotationEditor burst spotlight dim, step config, multi-select controls, and HUD label")
  func editorStyleAndStepWiring() throws {
    _ = NSApplication.shared
    let suite = "capture-editor-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let editor = AnnotationEditor(defaults: defaults)

    let burst = UUID()
    editor.styleBar.onSpotlightDim?(0.72, burst)
    editor.styleBar.onSpotlightDim?(0.82, burst)
    #expect(abs(editor.store.shown.spotlightDim - 0.82) < 0.001)
    editor.store.undo()
    #expect(abs(editor.store.shown.spotlightDim - 0.50) < 0.001)

    let step = Annotation(
      shape: .step(center: CGPoint(x: 30, y: 30), tip: nil), style: AnnotationStyle())
    var doc = editor.store.document
    doc.add(step)
    editor.store.commit(doc)
    editor.styleBar.onStepConfig?(.letters, 2)
    #expect(editor.store.document.stepLabel(of: step.id) == "C")

    // Pure mosaic multi-select must keep stroke controls without exposing colors.
    let m1 = Annotation(
      shape: .mosaic(CGRect(x: 0, y: 0, width: 20, height: 20)), style: AnnotationStyle())
    let m2 = Annotation(
      shape: .mosaicBrush([CGPoint(x: 30, y: 30), CGPoint(x: 40, y: 40)]), style: AnnotationStyle())
    var mDoc = editor.store.document
    mDoc.add(m1)
    mDoc.add(m2)
    editor.store.commit(mDoc)
    editor.store.selectedIDs = [m1.id, m2.id]
    let multiTarget = try #require(editor.styleTarget)
    #expect(multiTarget.controls.contains(.strokes))
    #expect(!multiTarget.controls.contains(.colors))

    editor.choose(.rectangle)
    #expect(editor.stepStroke(1))
    #expect(editor.styleCoordinator.currentSizeLabel()?.contains("pt") == true)
    editor.choose(.select)
    #expect(!editor.stepStroke(1))
  }

  private func makeSolidImage(size: CGSize, red: CGFloat, green: CGFloat, blue: CGFloat) throws
    -> CGImage
  {
    let (w, h) = (Int(size.width), Int(size.height))
    let srgb = try #require(CGColorSpace(name: CGColorSpace.sRGB))
    let ctx = try #require(
      CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: srgb,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    ctx.setFillColor(CGColor(srgbRed: red, green: green, blue: blue, alpha: 1))
    ctx.fill(CGRect(origin: .zero, size: size))
    return try #require(ctx.makeImage())
  }
}

private nonisolated struct StubCaptureTargeting: ElementTargeting {
  func begin(windows: [CaptureWindow]) async -> ElementDetection { .windowsOnly }
  func targets(at point: CGPoint) async -> [CGRect] { [] }
  func describe(at point: CGPoint, frame: CGRect) async -> ElementDescription? { nil }
  func scrollArea(around selection: CGRect) async -> LongScreenshotScrollProbe { .unknown }
  func end() async {}
}
