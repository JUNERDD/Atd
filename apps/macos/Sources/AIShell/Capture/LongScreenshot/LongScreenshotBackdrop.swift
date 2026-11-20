import AppKit

/// A mouse-ignoring backdrop panel ordered beneath one display's capture overlay during the long
/// screenshot's live phase. Holds the screen dim, selection outline, size label, and preview strip
/// so real scroll events pass straight through the transparent overlay above it to the live app.
final class LongScreenshotBackdrop {
  let displayID: CGDirectDisplayID
  let content: LongScreenshotBackdropView
  private let chrome: CaptureChromeView
  private let panel: LongScreenshotBackdropPanel

  init?(overlay: CaptureOverlayView) {
    guard let overlayWindow = overlay.window else { return nil }
    displayID = overlay.display.displayID
    let desktopFrame = overlay.bounds
    content = LongScreenshotBackdropView(desktopFrame: desktopFrame)
    chrome = CaptureChromeView(frame: desktopFrame)
    chrome.showsCornerBadge = false
    chrome.selectionCornerRadius = 0
    content.addSubview(chrome)
    panel = LongScreenshotBackdropPanel(frame: overlayWindow.frame, content: content)
    panel.order(.below, relativeTo: overlayWindow.windowNumber)
  }

  func update(area: CGRect?, label: String?) {
    chrome.update(area: area, handles: false, label: label)
  }

  func close() {
    PanelKeyboard.suppressResidentKey {
      panel.orderOut(nil)
      panel.contentView = nil
      panel.close()
    }
  }
}

/// Flipped desktop-coordinate host view for a display's long-screenshot backdrop panel.
final class LongScreenshotBackdropView: NSView {
  init(desktopFrame: CGRect) {
    super.init(frame: CGRect(origin: .zero, size: desktopFrame.size))
    setBoundsOrigin(desktopFrame.origin)
    wantsLayer = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
}

private final class LongScreenshotBackdropPanel: NSPanel {
  init(frame: CGRect, content: NSView) {
    super.init(
      contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    level = .screenSaver
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    animationBehavior = .none
    ignoresMouseEvents = true
    hidesOnDeactivate = false
    canHide = false
    isReleasedWhenClosed = false
    isMovable = false
    isExcludedFromWindowsMenu = true
    contentView = content
    setFrame(frame, display: false)
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}
