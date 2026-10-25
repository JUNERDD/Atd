import CoreGraphics
import Foundation

/// Whether macOS mouse-down hit-testing reaches the exact foreground step's window. Rectangle
/// overlap remains diagnostic evidence only: it cannot distinguish a transparent part of a
/// window from one that receives input. This does not prove every kind of visual visibility.
public enum ForegroundHitTest {
  /// One window on screen, as the window server lists it.
  public struct Window: Equatable, Sendable {
    public let number: Int
    public let pid: Int32
    /// Quartz global points, y down.
    public let bounds: CGRect
    /// Whether its overall alpha is nonzero; used only for rectangle diagnostics.
    public let visible: Bool

    public init(number: Int, pid: Int32, bounds: CGRect, visible: Bool) {
      self.number = number
      self.pid = pid
      self.bounds = bounds
      self.visible = visible
    }
  }

  public enum Verdict: Equatable, Sendable {
    /// The system hit-test names the exact target window in the fresh window list.
    case reaches
    /// The system hit is unknown or names another window, including the target app's own.
    case covered
    /// The step's window is not on screen, or does not hold the point.
    case offWindow
  }

  /// The input decision with the first overlapping rectangle, which need not intercept input.
  public struct Assessment: Equatable, Sendable {
    public let verdict: Verdict
    public let blocker: Window?
  }

  /// `hitWindowId` comes from the public macOS mouse-down hit-test, with no windows excluded.
  /// Unknown hits fail closed; neither shared ownership nor window level exempts a window.
  public static func verdict(
    _ point: CGPoint, target: Int, pid: Int32, windows: [Window], hitWindowId: Int?
  ) -> Verdict {
    assess(point, target: target, pid: pid, windows: windows, hitWindowId: hitWindowId).verdict
  }

  public static func assess(
    _ point: CGPoint, target: Int, pid: Int32, windows: [Window], hitWindowId: Int?
  ) -> Assessment {
    guard target > 0,
      let index = windows.firstIndex(where: { $0.number == target && $0.pid == pid }),
      windows[index].bounds.contains(point)
    else { return Assessment(verdict: .offWindow, blocker: nil) }
    let blocker = windows[..<index].first { window in
      window.visible && window.bounds.contains(point)
    }
    guard let hitWindowId, hitWindowId > 0,
      let hit = windows.first(where: { $0.number == hitWindowId }),
      hit.number == target, hit.pid == pid
    else { return Assessment(verdict: .covered, blocker: blocker) }
    return Assessment(verdict: .reaches, blocker: blocker)
  }
}
