import Foundation

/// A device resource the shell's arbiter hands out (decision D6, plan §6.2). Every native writer
/// on this Mac, the computer host's engines and the shell's own legacy writers alike, claims the
/// resources its effect can touch before it starts, and holds them until the effect converged.
///
/// - ``interactiveScreen``: the user is working with a modal surface of the shell (a capture
///   session's overlays, an open or save panel). Background writes are refused, never queued.
/// - ``globalInput``: synthesized keyboard or mouse events and app activation, which reach
///   whatever app is frontmost.
/// - ``clipboard``: the general pasteboard, held for a whole save, write and restore transaction.
/// - ``process(pid:start:)``: one running app, identified by its pid and its start time so a reused
///   pid is another process; focus-related writes into it run one at a time.
/// - ``page(profileId:contextId:pageId:)``: one browser page of a managed profile; observe, write
///   and verify on the same page run one at a time, different pages concurrently.
public enum DeviceResource: Hashable, Sendable {
  case interactiveScreen
  case globalInput
  case clipboard
  case process(pid: Int32, start: UInt64)
  case page(profileId: String, contextId: String, pageId: String)

  /// The fixed acquisition order (D6): interactiveScreen, globalInput, clipboard, process, page.
  /// An owner that holds a claim may add a later claim only of resources ranked at or after the
  /// last one it holds, so no two owners can wait on each other in opposite orders.
  public var acquisitionRank: Int {
    switch self {
    case .interactiveScreen: 0
    case .globalInput: 1
    case .clipboard: 2
    case .process: 3
    case .page: 4
    }
  }

  /// Whether one owner holding `self` keeps another from holding `other`, regardless of who owns
  /// either (``ResourceClaimPlan`` decides what the owners' priorities make of it).
  ///
  /// The interactive screen and global input exclude each other and every process and page,
  /// since synthesized input or a modal surface can reach any of them; the clipboard is its own
  /// transaction and excludes only itself. Processes and pages conflict only with the same one; a
  /// browser driven through its native UI claims its process and global input as well.
  public func conflicts(with other: DeviceResource) -> Bool {
    switch (self, other) {
    case (.clipboard, .clipboard): true
    case (.clipboard, _), (_, .clipboard): false
    case (.interactiveScreen, _), (_, .interactiveScreen): true
    case (.globalInput, _), (_, .globalInput): true
    case (.process, .process), (.page, .page): self == other
    case (.process, .page), (.page, .process): false
    }
  }

  /// Whether the resource is the user's own surface or input rather than a background target.
  public var isSessionWide: Bool {
    switch self {
    case .interactiveScreen, .globalInput, .clipboard: true
    case .process, .page: false
    }
  }

  /// `resources` in acquisition order; resources of one rank are ordered by their identity, so
  /// the order is total and the same on every evaluation.
  public static func acquisitionOrder(_ resources: some Sequence<DeviceResource>)
    -> [DeviceResource]
  {
    resources.sorted()
  }
}

extension DeviceResource: Comparable {
  public static func < (lhs: DeviceResource, rhs: DeviceResource) -> Bool {
    if lhs.acquisitionRank != rhs.acquisitionRank {
      return lhs.acquisitionRank < rhs.acquisitionRank
    }
    switch (lhs, rhs) {
    case (.process(let pid, let start), .process(let otherPid, let otherStart)):
      return (pid, start) < (otherPid, otherStart)
    case (.page(let profile, let context, let page), .page(let rProfile, let rContext, let rPage)):
      return (profile, context, page) < (rProfile, rContext, rPage)
    default:
      return false
    }
  }
}
