import AICore
import Foundation

extension WidgetNode {
  /// Levels of nesting, the node itself counting one. The renderer stops at
  /// ``WidgetContract/maxDepth`` and the reader refuses deeper trees.
  public var depth: Int {
    switch self {
    case .vstack(let stack): 1 + (stack.children.map(\.depth).max() ?? 0)
    case .hstack(let stack): 1 + (stack.children.map(\.depth).max() ?? 0)
    case .zstack(let stack): 1 + (stack.children.map(\.depth).max() ?? 0)
    case .link(let link): 1 + link.child.depth
    default: 1
    }
  }

  /// The `src` of every `image` node, which the shell copies next to the snapshots.
  public var imageSources: [String] {
    switch self {
    case .vstack(let stack): stack.children.flatMap(\.imageSources)
    case .hstack(let stack): stack.children.flatMap(\.imageSources)
    case .zstack(let stack): stack.children.flatMap(\.imageSources)
    case .link(let link): link.child.imageSources
    case .image(let image): [image.src]
    default: []
    }
  }
}

/// One entry WidgetKit shows: the tree from `date` on, and the whole-widget route.
public struct WidgetPlannedEntry: Equatable, Sendable {
  public let date: Date
  public let view: WidgetNode
  public let route: String?
}

public enum WidgetTimelinePlan {
  /// The entries to hand WidgetKit at `now`, in ascending date: the latest entry already due
  /// becomes the current one, dated `now`, followed by the future ones. Entries whose date does
  /// not parse are dropped (the service validated them, so this is a corrupt file).
  public static func entries(of timeline: WidgetTimeline, now: Date) -> [WidgetPlannedEntry] {
    let dated = timeline.entries.compactMap { entry -> WidgetPlannedEntry? in
      guard let date = BridgeCoding.parseDateTime(entry.date) else { return nil }
      return WidgetPlannedEntry(date: date, view: entry.view, route: entry.route)
    }.sorted { $0.date < $1.date }
    let due = dated.last { $0.date <= now }
    let future = dated.filter { $0.date > now }
    guard let due else { return future }
    return [WidgetPlannedEntry(date: now, view: due.view, route: due.route)] + future
  }
}

/// Whether macOS can show this build's widgets from where it is installed. WidgetKit offers a
/// widget's default configuration only for hosts in a location LaunchServices indexes for App
/// Intents metadata (`/Applications`, `~/Applications`); elsewhere (T1b: `/private/tmp`, the
/// repository's DerivedData under `~/Documents`) the widget stays a placeholder and its timeline
/// fails with error 1103, which nothing reports to the host.
public enum WidgetPlacement {
  public static func isIndexed(bundleURL: URL, home: URL) -> Bool {
    let path = bundleURL.standardizedFileURL.resolvingSymlinksInPath().path(percentEncoded: false)
    let roots = [
      "/Applications/",
      home.appending(path: "Applications", directoryHint: .isDirectory)
        .path(percentEncoded: false),
    ]
    return roots.contains { path.hasPrefix($0.hasSuffix("/") ? $0 : $0 + "/") }
  }
}
