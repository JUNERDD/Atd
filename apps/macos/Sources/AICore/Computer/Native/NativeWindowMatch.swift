import Foundation

/// Finds the window-server id of a window the shell found through accessibility, which names
/// the window's frame but not its id. The two meet on the frame; a frame that matches no window
/// or several is not guessed.
public enum NativeWindowMatch {
  public enum Failure: Error, Equatable, Sendable {
    case notFound
    case ambiguous
  }

  /// One layer-0 window of an app, as the window server lists it.
  public struct ServerWindow: Equatable, Sendable {
    public let windowId: Int
    public let pid: Int
    /// Quartz global points, y down.
    public let bounds: CGRect?

    public init(windowId: Int, pid: Int, bounds: CGRect?) {
      self.windowId = windowId
      self.pid = pid
      self.bounds = bounds
    }
  }

  /// Frames from the two sources may differ by rounding.
  static let tolerance: CGFloat = 2

  public static func windowId(frame: CGRect, pid: Int, among windows: [ServerWindow])
    -> Result<Int, Failure>
  {
    let candidates = windows.filter { window in
      guard window.pid == pid, let bounds = window.bounds else { return false }
      return abs(bounds.minX - frame.minX) <= tolerance
        && abs(bounds.minY - frame.minY) <= tolerance
        && abs(bounds.width - frame.width) <= tolerance
        && abs(bounds.height - frame.height) <= tolerance
    }
    switch candidates.count {
    case 0: return .failure(.notFound)
    case 1: return .success(candidates[0].windowId)
    default: return .failure(.ambiguous)
    }
  }
}

/// Which window of an application target is its root (plan, Clarifying Questions): resolving
/// never asks the person. The app's main window (`AXMainWindow`) wins, then its focused window
/// (`AXFocusedWindow`), then its front-most window on screen, then any other standard window; a
/// minimized one is used only when the app has nothing else, so observing it says it is
/// minimized rather than the host picking a hidden window. Every other top-level window of the
/// app is listed as an `ownedWindow` surface the model can switch to.
public enum NativeRootWindow {
  /// A window a rule names, with whether it is minimized.
  public struct Candidate: Equatable, Sendable {
    public let windowId: Int
    public let minimized: Bool

    public init(windowId: Int, minimized: Bool) {
      self.windowId = windowId
      self.minimized = minimized
    }
  }

  /// The root window id; nil when the app shows no window at all.
  public static func choose(
    main: Candidate?, focused: Candidate?, frontmost: Int?, standard: [Candidate]
  ) -> Int? {
    let ranked = [main, focused].compactMap { $0 }
    if let open = ranked.first(where: { !$0.minimized }) { return open.windowId }
    if let frontmost { return frontmost }
    if let open = standard.first(where: { !$0.minimized }) { return open.windowId }
    return ranked.first?.windowId ?? standard.first?.windowId
  }
}
