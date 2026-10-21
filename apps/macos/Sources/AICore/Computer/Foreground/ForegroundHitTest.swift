import CoreGraphics
import Foundation

/// Whether the spot a foreground step acts on is in view (R4.4): on the step's window, with no
/// other app's window over it. The input itself is addressed to the step's window whatever lies
/// above it; the test keeps a step from acting where the person cannot see it, Atd's own panel
/// included.
public enum ForegroundHitTest {
  /// One window on screen, as the window server lists it.
  public struct Window: Equatable, Sendable {
    public let number: Int
    public let pid: Int32
    /// Quartz global points, y down.
    public let bounds: CGRect
    /// Whether it draws anything (an alpha of 0 shows nothing and is not counted).
    public let visible: Bool

    public init(number: Int, pid: Int32, bounds: CGRect, visible: Bool) {
      self.number = number
      self.pid = pid
      self.bounds = bounds
      self.visible = visible
    }
  }

  public enum Verdict: Equatable, Sendable {
    /// The window shows the point and nothing above it takes it.
    case reaches
    /// Another window above the step's window holds the point.
    case covered
    /// The step's window is not on screen, or does not hold the point.
    case offWindow
  }

  /// Whether `point` is in view on window `target` of `pid`, with `windows` on screen front to
  /// back: it is when that window holds the point and no window above it does, except the target
  /// app's own (its sheets, popovers and menus belong to the step) and `passThrough`, Atd's own
  /// windows that let clicks through (the live pointer). Every other window counts, whatever its
  /// layer or owner: another app's window, the menu bar, the Dock and Atd's own panel alike.
  public static func verdict(
    _ point: CGPoint, target: Int, pid: Int32, windows: [Window], passThrough: Set<Int>
  ) -> Verdict {
    guard let index = windows.firstIndex(where: { $0.number == target }),
      windows[index].bounds.contains(point)
    else { return .offWindow }
    let covered = windows[..<index].contains { window in
      window.visible && window.pid != pid && !passThrough.contains(window.number)
        && window.bounds.contains(point)
    }
    return covered ? .covered : .reaches
  }
}
