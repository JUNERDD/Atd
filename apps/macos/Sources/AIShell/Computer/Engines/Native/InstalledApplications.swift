import AICore
import AppKit

/// Shared installation discovery for composer mentions and on-demand computer access.
/// The catalog reads bundle metadata only; access resolution separately reads the signing identity.
nonisolated enum InstalledApplications {
  typealias Application = ComputerListApplicationsResult.Application

  @MainActor
  static func list() async -> ComputerListApplicationsResult {
    let workspace = NSWorkspace.shared
    let running = workspace.runningApplications.compactMap(\.bundleURL)
    let own = Bundle.main.bundleIdentifier
    let identifiers = await NativeTargetProbe.detached {
      Set(urls(running: running).compactMap { Bundle(url: $0)?.bundleIdentifier }).filter {
        !$0.isEmpty && $0.unicodeScalars.count <= 255 && $0 != own
          && $0 != "com.junerdd.ai" && !$0.hasPrefix("com.junerdd.ai.")
      }
    }
    // requestAccess resolves bundle ids through LaunchServices too. Show that preferred copy,
    // rather than presenting two installations of one identity as separately addressable apps.
    let preferred = identifiers.compactMap { identifier -> (String, URL)? in
      workspace.urlForApplication(withBundleIdentifier: identifier).map { (identifier, $0) }
    }
    let applications = await NativeTargetProbe.detached {
      preferred.compactMap { identifier, url -> Application? in
        guard let bundle = Bundle(url: url), bundle.bundleIdentifier == identifier else {
          return nil
        }
        let display = FileManager.default.displayName(atPath: url.path)
        let name = display.lowercased().hasSuffix(".app") ? String(display.dropLast(4)) : display
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return Application(
          bundleId: identifier,
          name: trimmed.isEmpty ? identifier : String(trimmed.unicodeScalars.prefix(255)))
      }.sorted {
        let order = $0.name.localizedStandardCompare($1.name)
        return order == .orderedSame ? $0.bundleId < $1.bundleId : order == .orderedAscending
      }
    }
    return .init(applications: Array(applications.prefix(2_048)))
  }

  /// Exact metadata matching preserves ambiguity: only the caller decides whether one match is
  /// usable. A bundle-id request uses the same preferred installation as the catalog.
  static func matching(_ name: String, direct: URL?, running: [URL]) -> [NativeAppIdentity] {
    if let direct, let identity = NativeAppIdentity.read(path: direct.path) { return [identity] }
    let manager = FileManager.default
    let wanted = name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    return urls(running: running).compactMap { url in
      guard let bundle = Bundle(url: url) else { return nil }
      let names = [
        bundle.bundleIdentifier,
        bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String,
        bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
        url.deletingPathExtension().lastPathComponent,
        manager.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: ""),
      ]
      guard
        names.compactMap({ $0 }).contains(where: {
          $0.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) == wanted
        })
      else { return nil }
      return NativeAppIdentity.read(path: url.path)
    }
  }

  private static func urls(running: [URL]) -> Set<URL> {
    let manager = FileManager.default
    var urls = Set(running)
    let roots = [
      URL(filePath: "/Applications"), URL(filePath: "/System/Applications"),
      manager.homeDirectoryForCurrentUser.appending(path: "Applications"),
    ]
    for root in roots {
      guard
        let entries = manager.enumerator(
          at: root, includingPropertiesForKeys: [.isHiddenKey, .isSymbolicLinkKey],
          options: [.skipsPackageDescendants])
      else { continue }
      for case let url as URL in entries {
        guard let values = try? url.resourceValues(forKeys: [.isHiddenKey, .isSymbolicLinkKey])
        else {
          entries.skipDescendants()
          continue
        }
        if values.isHidden == true {
          entries.skipDescendants()
          // macOS exposes some system apps through hidden installation symlinks. Admit only
          // links to real app bundles, without descending into other hidden files or folders.
          guard values.isSymbolicLink == true, url.pathExtension == "app",
            let resolved = try? url.resolvingSymlinksInPath().resourceValues(forKeys: [
              .isApplicationKey
            ]),
            resolved.isApplication == true
          else { continue }
        }
        if url.pathExtension == "app" { urls.insert(url) }
      }
    }
    return urls
  }
}
