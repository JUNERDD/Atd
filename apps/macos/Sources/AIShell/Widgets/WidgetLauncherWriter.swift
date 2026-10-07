import AICore
import AIWidgetModel
import Foundation

/// Writes the "My Apps" launcher's files into ``WidgetFiles``: each listed app's icon as
/// `icons/<appId>.svg`, then `launcher.json`, then removes the icons of apps no longer listed, so
/// a listed app finds its icon and the list never names an icon that was just removed.
///
/// An icon is SVG an agent wrote. The shell copies its bytes and never parses or draws them; the
/// sandboxed extension does, and a desktop pin's tile has it drawn out of process
/// (``PinIconRasterizer``). A copy is made only when the app's icon revision (its build revision,
/// which an in-place build of the current version changes too) differs from the one copied
/// before. The source is the build's `icon.svg` beside its `web/` root (the service's
/// `versions/.rev-<k>/` layout); it must resolve inside that directory (``StaticFileResolver``
/// refuses links and `..`) and pass ``WidgetLauncherIcon/accepts(_:)``, otherwise the copy is
/// removed and the launcher draws the app's fallback tile. Each file is replaced atomically and
/// only when its content differs, so the caller reloads the launcher's timelines only for a real
/// change. Nonisolated: the disk work runs off the main actor.
nonisolated enum WidgetLauncherWriter {
  struct Outcome: Sendable {
    /// Per listed app, the icon revision whose icon, or its absence, `icons/` now holds.
    let icons: [String: Int]
    /// Whether `launcher.json` or an icon changed.
    let changed: Bool
  }

  /// `copied` is the previous outcome's `icons`. `runtimes` holds the current runtime of each app
  /// whose icon revision differs from it (others are not looked at); an app missing there, or
  /// whose icon cannot be read now, keeps its old copy and is tried again on the next write. A
  /// runtime read after the listing may already hold a newer build; its icon is recorded under
  /// the listed revision, so the next listing of that build copies it once more at most.
  @concurrent
  static func write(
    _ apps: [WidgetLauncherApp], runtimes: [String: UserAppRuntime], copied: [String: Int],
    to files: WidgetFiles
  ) async throws -> Outcome {
    let manager = FileManager.default
    try manager.createDirectory(at: files.iconsURL, withIntermediateDirectories: true)
    let listed = Set(apps.map(\.appId))
    var icons = copied.filter { listed.contains($0.key) }
    var changed = false
    for app in apps where icons[app.appId] != app.iconRevision {
      guard let runtime = runtimes[app.appId] else { continue }
      let icon: Data?
      do {
        icon = try self.icon(of: runtime)
      } catch {
        continue
      }
      if try replace(files.iconURL(appId: app.appId), with: icon) { changed = true }
      icons[app.appId] = app.iconRevision
    }
    let launcher = WidgetLauncherFile(apps: apps)
    if (try? files.readLauncher().get()) != launcher {
      try JSONEncoder().encode(launcher).write(to: files.launcherURL, options: .atomic)
      changed = true
    }
    let kept = Set(listed.map { files.iconURL(appId: $0).lastPathComponent })
    for name in (try? manager.contentsOfDirectory(atPath: files.iconsURL.path())) ?? []
    where !kept.contains(name) {
      try? manager.removeItem(at: files.iconsURL.appending(path: name))
      changed = true
    }
    return Outcome(icons: icons, changed: changed)
  }

  /// The build's `icon.svg` as the launcher may use it, or nil when the build has none or it fails
  /// the byte checks. Throws when the file is there but cannot be read.
  static func icon(of runtime: UserAppRuntime) throws -> Data? {
    let version = runtime.webRootURL.deletingLastPathComponent()
    guard let path = try? RelayPath.normalize("/icon.svg"),
      let file = StaticFileResolver(root: version).resolve(path)
    else { return nil }
    let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size <= WidgetContract.launcherIconMaxBytes else { return nil }
    let data = try Data(contentsOf: file)
    return WidgetLauncherIcon.accepts(data) ? data : nil
  }

  /// Makes `url` hold `data`, or no file for nil; answers whether anything changed.
  private static func replace(_ url: URL, with data: Data?) throws -> Bool {
    let current = try? Data(contentsOf: url)
    guard current != data else { return false }
    if let data {
      try data.write(to: url, options: .atomic)
    } else {
      try FileManager.default.removeItem(at: url)
    }
    return true
  }
}
