import AICore
import AppKit

/// Conversions between AppKit screens and the AICore geometry, which uses the same y-up
/// global coordinates in points.
@MainActor
enum Screens {
  /// The work area (`visibleFrame`) of the display under the cursor, or the nearest one.
  static func workAreaUnderCursor() -> ScreenRect {
    let cursor = NSEvent.mouseLocation
    return workArea(nearestTo: cursor.x, cursor.y)
  }

  /// The work area of the display holding most of `frame`, or the one nearest its center.
  static func workArea(containing frame: ScreenRect) -> ScreenRect {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return ScreenRect(best.visibleFrame) }
    return workArea(nearestTo: rect.midX, rect.midY)
  }

  private static func workArea(nearestTo x: Double, _ y: Double) -> ScreenRect {
    let screens = NSScreen.screens
    let index = DisplaySelection.index(nearestTo: x, y, in: screens.map { ScreenRect($0.frame) })
    guard let index else {
      // No display attached (a transient state while displays rearrange).
      return ScreenRect(x: 0, y: 0, width: 1440, height: 900)
    }
    return ScreenRect(screens[index].visibleFrame)
  }

  private static func area(_ rect: NSRect) -> CGFloat {
    rect.isNull ? 0 : rect.width * rect.height
  }
}

extension NSScreen {
  /// The Core Graphics display this screen shows (`NSScreenNumber`), which ScreenCaptureKit and
  /// `CGDisplayBounds` name displays by.
  var displayID: CGDirectDisplayID? {
    (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }
}

extension ScreenRect {
  init(_ rect: NSRect) {
    self.init(
      x: Double(rect.origin.x), y: Double(rect.origin.y), width: Double(rect.width),
      height: Double(rect.height))
  }
}

extension NSRect {
  init(_ rect: ScreenRect) {
    self.init(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
  }
}

/// The window background both windows share: Liquid Glass behind a transparent web view.
@MainActor
enum GlassBackground {
  static func make(content: NSView) -> NSView {
    let glass = NSGlassEffectView()
    glass.contentView = content
    return glass
  }
}

/// The transparent 52pt title bar both windows share. An empty unified `NSToolbar` sets the bar's
/// height, centers the traffic lights in it and gives the window the toolbar window's corner
/// radius; the page lays its header out on that bar and reports it as a drag region. The toolbar
/// has no items and cannot be customized, so the bar keeps its height and clicks under it still
/// reach the web view.
@MainActor
enum UnifiedTitleBar {
  static func apply(to window: NSWindow, identifier: String) {
    let toolbar = NSToolbar(identifier: identifier)
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.toolbar = toolbar
    window.toolbarStyle = .unified
    window.titlebarSeparatorStyle = .none
  }
}
