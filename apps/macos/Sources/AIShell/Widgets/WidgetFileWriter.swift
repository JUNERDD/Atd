import AICore
import AIWidgetModel
import Foundation

/// Writes a ``WidgetSync`` into ``WidgetFiles``. Every file is replaced atomically, so the
/// extension never reads half a file; the snapshots and images go first and `catalog.json`
/// last, so a configuration listed by the catalog finds its content. Snapshots of widgets the
/// service no longer lists are removed, and the images directory is rebuilt whole.
///
/// Images: an `image` node names a file of the app's current version, which the sandboxed
/// extension cannot read, so each referenced file is copied beside the snapshots. A copy must
/// resolve inside the app's `web/` root (``StaticFileResolver`` refuses links and `..`), stay
/// within ``WidgetContract/imageMaxBytes`` and start with a PNG or JPEG signature; anything else
/// is left out and the renderer shows a placeholder. Nonisolated: the disk work runs off the
/// main actor.
nonisolated enum WidgetFileWriter {
  /// The image paths each app's snapshots reference.
  static func imageSources(of sync: WidgetSync) -> [String: Set<String>] {
    var sources: [String: Set<String>] = [:]
    for (key, snapshot) in sync.snapshots {
      guard let appId = key.split(separator: "/").first.map(String.init) else { continue }
      for entry in snapshot.timeline.entries {
        sources[appId, default: []].formUnion(entry.view.imageSources)
      }
    }
    return sources
  }

  /// `roots` maps an app id to its current version's `web/` directory.
  @concurrent
  static func write(_ sync: WidgetSync, roots: [String: URL], to files: WidgetFiles, at now: Date)
    async throws
  {
    let manager = FileManager.default
    try manager.createDirectory(at: files.snapshotsURL, withIntermediateDirectories: true)
    var kept: Set<String> = []
    let encoder = JSONEncoder()
    for (key, snapshot) in sync.snapshots {
      let parts = key.split(separator: "/").map(String.init)
      guard parts.count == 3, let family = WidgetFamily(rawValue: parts[2]) else { continue }
      let url = files.snapshotURL(appId: parts[0], widgetId: parts[1], family: family)
      try encoder.encode(snapshot).write(to: url, options: .atomic)
      kept.insert(url.lastPathComponent)
    }
    for name in (try? manager.contentsOfDirectory(atPath: files.snapshotsURL.path())) ?? []
    where !kept.contains(name) {
      try? manager.removeItem(at: files.snapshotsURL.appending(path: name))
    }
    try copyImages(imageSources(of: sync), roots: roots, to: files)
    let catalog = WidgetCatalogFile(writtenAt: now.formatted(.iso8601), apps: sync.catalog)
    try encoder.encode(catalog).write(to: files.catalogURL, options: .atomic)
  }

  /// Builds the images beside the old ones, then swaps them in.
  private static func copyImages(
    _ sources: [String: Set<String>], roots: [String: URL], to files: WidgetFiles
  ) throws {
    let manager = FileManager.default
    let staging = files.directory.appending(path: "images.new", directoryHint: .isDirectory)
    try? manager.removeItem(at: staging)
    try manager.createDirectory(at: staging, withIntermediateDirectories: true)
    for (appId, srcs) in sources {
      guard let root = roots[appId] else { continue }
      let resolver = StaticFileResolver(root: root)
      for src in srcs {
        guard let path = try? RelayPath.normalize("/" + src), let file = resolver.resolve(path),
          let data = try? Data(contentsOf: file), isImage(data)
        else { continue }
        // Same relative layout as WidgetFiles.imageURL, under the staging directory.
        let destination = staging.appending(path: appId, directoryHint: .isDirectory)
          .appending(path: src)
        try manager.createDirectory(
          at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: destination, options: .atomic)
      }
    }
    try? manager.removeItem(at: files.imagesURL)
    try manager.moveItem(at: staging, to: files.imagesURL)
  }

  private static func isImage(_ data: Data) -> Bool {
    guard data.count <= WidgetContract.imageMaxBytes else { return false }
    let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    let jpeg = Data([0xFF, 0xD8, 0xFF])
    return data.starts(with: png) || data.starts(with: jpeg)
  }
}
