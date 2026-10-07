import AICore
import AppKit

/// The displays desktop pins sit on, in the AICore geometry (AppKit's y-up global points). A pin
/// names its display by UUID, which survives restarts and reconnections, unlike a display id.
enum DesktopPinScreens {
  /// A display and its work area (`visibleFrame`).
  struct Placement {
    let display: String?
    let workArea: ScreenRect
  }

  /// The display with this UUID; the main display while it is gone, so the pin shows there at
  /// the same offset and returns once its display does.
  static func placement(display: String?) -> Placement {
    let screens = NSScreen.screens
    let screen = screens.first { display != nil && $0.displayUUID == display } ?? screens.first
    return placement(of: screen)
  }

  /// The display holding most of `frame`, else the one nearest its center.
  static func placement(containing frame: ScreenRect) -> Placement {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return placement(of: best) }
    return placement(nearestTo: rect.midX, rect.midY)
  }

  /// The display containing the point, else the nearest one.
  static func placement(nearestTo x: Double, _ y: Double) -> Placement {
    let screens = NSScreen.screens
    let index = DisplaySelection.index(nearestTo: x, y, in: screens.map { ScreenRect($0.frame) })
    return placement(of: index.map { screens[$0] })
  }

  private static func placement(of screen: NSScreen?) -> Placement {
    guard let screen else {
      // No display attached: a transient state while displays rearrange.
      return Placement(display: nil, workArea: ScreenRect(x: 0, y: 0, width: 1440, height: 900))
    }
    return Placement(display: screen.displayUUID, workArea: ScreenRect(screen.visibleFrame))
  }

  private static func area(_ rect: NSRect) -> CGFloat {
    rect.isNull ? 0 : rect.width * rect.height
  }
}

extension NSScreen {
  /// `CGDisplayCreateUUIDFromDisplayID` as a string.
  var displayUUID: String? {
    guard let displayID, let uuid = CGDisplayCreateUUIDFromDisplayID(displayID) else { return nil }
    return CFUUIDCreateString(nil, uuid.takeRetainedValue()) as String?
  }
}
