import AICore
import AppKit

/// Conversions between AppKit screens and the AICore geometry, which uses the same y-up
/// global coordinates in points.
enum Screens {
  /// The work area (`visibleFrame`) of the display under the cursor, or the nearest one.
  static func workAreaUnderCursor() -> ScreenRect {
    displayUnderCursor().workArea
  }

  /// The full `frame` (menu bar and Dock included) of the display under the cursor, or the
  /// nearest one.
  static func frameUnderCursor() -> ScreenRect {
    let cursor = NSEvent.mouseLocation
    return frame(nearestTo: cursor.x, cursor.y)
  }

  /// The work area of the display holding most of `frame`, or the one nearest its center.
  static func workArea(containing frame: ScreenRect) -> ScreenRect {
    display(containing: frame).workArea
  }

  /// A display a panel is placed on: its work area and its stable identifier, nil while the
  /// display is gone (``fallback``).
  struct Display {
    let workArea: ScreenRect
    let uuid: String?
  }

  /// The display under the cursor, or the nearest one.
  static func displayUnderCursor() -> Display {
    let cursor = NSEvent.mouseLocation
    return display(screen(nearestTo: cursor.x, cursor.y))
  }

  /// The display holding most of `frame`, or the one nearest its center.
  static func display(containing frame: ScreenRect) -> Display {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return display(best) }
    return display(screen(nearestTo: rect.midX, rect.midY))
  }

  private static func display(_ screen: NSScreen?) -> Display {
    guard let screen else { return Display(workArea: fallback, uuid: nil) }
    return Display(workArea: ScreenRect(screen.visibleFrame), uuid: screen.displayUUID)
  }

  /// The full frame of the display holding most of `frame`, or the one nearest the cursor when
  /// that display is gone.
  static func frame(containing frame: ScreenRect) -> ScreenRect {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return ScreenRect(best.frame) }
    return frameUnderCursor()
  }

  private static func frame(nearestTo x: Double, _ y: Double) -> ScreenRect {
    guard let screen = screen(nearestTo: x, y) else { return fallback }
    return ScreenRect(screen.frame)
  }

  private static func screen(nearestTo x: Double, _ y: Double) -> NSScreen? {
    let screens = NSScreen.screens
    let index = DisplaySelection.index(nearestTo: x, y, in: screens.map { ScreenRect($0.frame) })
    return index.map { screens[$0] }
  }

  /// No display attached (a transient state while displays rearrange).
  private static let fallback = ScreenRect(x: 0, y: 0, width: 1440, height: 900)

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

/// The window background every page window shares: the window material
/// (``NativeMaterialView``, Liquid Glass on macOS 26) behind a transparent web view, which stays
/// off the glass's rim (``GlassRimClipView``).
enum GlassBackground {
  static func make(content: NSView) -> NSView {
    let material = NativeMaterialView(.window)
    if #available(macOS 26, *) {
      material.contentView = GlassRimClipView(content: content)
    } else {
      material.contentView = content
    }
    return material.view
  }
}

/// The transparent 52pt title bar every page window shares. An empty unified `NSToolbar` sets
/// the bar's height, centers the traffic lights in it and gives the window the toolbar window's
/// corner radius; the page lays its header out on that bar and reports it as a drag region. The
/// toolbar has no items and cannot be customized, so the bar keeps its height and clicks under it
/// still reach the web view.
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
