import CoreGraphics
import Foundation

/// A browser window's frame in the browser's own window space (CDP `Browser` domain): points,
/// the origin at the top-left corner of the primary display, y growing downward.
public struct BrowserWindowRect: Equatable, Sendable {
  public var left: Int
  public var top: Int
  public var width: Int
  public var height: Int

  public init(left: Int, top: Int, width: Int, height: Int) {
    self.left = left
    self.top = top
    self.width = width
    self.height = height
  }
}

/// Where the host puts the managed browser's windows (plan §7). A window opened for a run is
/// parked beyond the displays so it never shows over the person's work, and a person who opens
/// the browser themselves gets it back on a display.
public enum BrowserWindowPlacement {
  /// What a parked window is asked to be: Chrome's smallest window, so nothing smaller is
  /// requested and then raised.
  public static let parkedSize = (width: 500, height: 375)
  /// How far beyond the displays a window is asked to go.
  private static let margin = 100

  /// A Cocoa frame (the origin at the bottom-left corner of the primary display, y up) in window
  /// space; `primaryHeight` is the primary display's height.
  public static func windowSpace(_ frame: CGRect, primaryHeight: CGFloat) -> BrowserWindowRect {
    BrowserWindowRect(
      left: Int(frame.minX.rounded()), top: Int((primaryHeight - frame.maxY).rounded()),
      width: Int(frame.width.rounded()), height: Int(frame.height.rounded()))
  }

  /// The frame a window is asked to take to leave every display: past the left and top edges of
  /// the displays together. macOS does not allow it, and keeps part of the window on a display:
  /// the S8 probe asked for (-32000, -32000) and read back a window 40 points wide along the left
  /// edge, just below the menu bar, at Chrome's minimum size. So what the browser reports back is
  /// logged, and the window stays at the back of the stacking order.
  public static func parked(displays: [BrowserWindowRect]) -> BrowserWindowRect {
    BrowserWindowRect(
      left: (displays.map(\.left).min() ?? 0) - parkedSize.width - margin,
      top: (displays.map(\.top).min() ?? 0) - parkedSize.height - margin,
      width: parkedSize.width, height: parkedSize.height)
  }

  /// A normal window on `display`: four fifths of it, at most 1200 by 800, centered.
  public static func normal(on display: BrowserWindowRect) -> BrowserWindowRect {
    let width = max(parkedSize.width, min(1200, display.width * 4 / 5))
    let height = max(parkedSize.height, min(800, display.height * 4 / 5))
    return BrowserWindowRect(
      left: display.left + (display.width - width) / 2,
      top: display.top + (display.height - height) / 2, width: width, height: height)
  }
}
