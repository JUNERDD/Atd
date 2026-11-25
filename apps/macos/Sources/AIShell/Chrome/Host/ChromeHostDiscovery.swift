import AIChromeChannelKit
import Darwin
import Foundation

/// Discovers Chromium browser user-data directories under `~/Library/Application Support` so
/// ``ChromeHostManifest`` can register `atd-chrome-host` for every installed Chromium browser.
/// Curated browsers require active profile markers (skipping phantom installer directories);
/// unknown Chromium forks are discovered dynamically at depths 1–2 only when they contain our
/// extension, excluding Apple, Atd, Gecko, and common Electron/embedded-Chromium apps.
nonisolated enum ChromeHostDiscovery {
  struct Target: Equatable, Sendable {
    let directory: URL
    let displayName: String
  }

  private static let maxMetadataBytes: Int64 = 16 * 1024 * 1024
  private static let maxDynamicProfiles = 32

  /// Known Chromium user-data folders relative to `~/Library/Application Support`.
  static let curated: [(relativePath: String, displayName: String)] = [
    ("Google/Chrome", "Google Chrome"),
    ("Google/Chrome Beta", "Google Chrome Beta"),
    ("Google/Chrome Dev", "Google Chrome Dev"),
    ("Google/Chrome Canary", "Google Chrome Canary"),
    ("Microsoft Edge", "Microsoft Edge"),
    ("Microsoft Edge Beta", "Microsoft Edge Beta"),
    ("Microsoft Edge Dev", "Microsoft Edge Dev"),
    ("Microsoft Edge Canary", "Microsoft Edge Canary"),
    ("BraveSoftware/Brave-Browser", "Brave Browser"),
    ("BraveSoftware/Brave-Browser-Beta", "Brave Browser Beta"),
    ("BraveSoftware/Brave-Browser-Nightly", "Brave Browser Nightly"),
    ("Arc/User Data", "Arc"),
    ("Dia/User Data", "Dia"),
    ("Vivaldi", "Vivaldi"),
    ("com.operasoftware.Opera", "Opera"),
    ("com.operasoftware.OperaGX", "Opera GX"),
    ("Chromium", "Chromium"),
    ("Aside", "Aside"),
    ("Comet", "Comet"),
    ("OpenAI/ChatGPT Atlas", "ChatGPT Atlas"),
    ("com.openai.atlas/browser-data/host", "ChatGPT Atlas"),
    ("net.imput.helium", "Helium"),
    ("Thorium", "Thorium"),
  ]

  private static let excludedTopPrefixes = [
    "com.apple.", "com.junerdd.ai", "agentservice", "atd ",
  ]

  private static let excludedTopNames: Set<String> = [
    "atd", "firefox", "mozilla", "zen", "waterfox", "librewolf", "floorp", "torbrowser-data",
    "code", "code - insiders", "cursor", "claude", "notion", "larkshell", "antigravity",
    "antigravity ide", "discord", "slack", "spotify", "electron", "docker desktop", "obsidian",
    "com.openai.codex", "chrome-devtools-mcp",
  ]

  private static let excludedRelativePaths: Set<String> = [
    "google/chrome for testing", "google/chromefortesting", "google/chrome-headless",
    "openai/codex",
  ]

  /// Returns all Chromium user-data directories under `home/Library/Application Support` that
  /// should receive the native messaging host manifest, deduplicated case-insensitively.
  static func discover(
    extensionId: String,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> [Target] {
    let appSupport = home.appending(
      path: "Library/Application Support", directoryHint: .isDirectory)
    guard isRealDirectory(appSupport) else { return [] }

    var targets: [Target] = []
    var seen = Set<String>()

    func appendIfNew(_ directory: URL, displayName: String) {
      let key = canonicalKey(directory)
      guard seen.insert(key).inserted else { return }
      targets.append(Target(directory: directory, displayName: displayName))
    }

    // 1. Curated Chromium browsers (gated on active profile markers).
    for entry in curated {
      guard let dir = realPathChain(under: appSupport, relative: entry.relativePath),
        isChromiumUserDataDirectory(dir)
      else { continue }
      appendIfNew(dir, displayName: entry.displayName)
    }

    // 2. Dynamic scan (depths 1 and 2) for unknown Chromium forks that have our extension.
    for top in realSubdirectories(of: appSupport) {
      guard !isExcludedTopName(top.name) else { continue }
      if isChromiumUserDataDirectory(top.url) {
        if !seen.contains(canonicalKey(top.url)),
          hasDynamicExtension(in: top.url, extensionId: extensionId)
        {
          appendIfNew(top.url, displayName: dynamicDisplayName(leaf: top.name, parent: nil))
        }
        continue
      }
      for child in realSubdirectories(of: top.url) {
        let rel = "\(top.name)/\(child.name)".lowercased()
        guard !excludedRelativePaths.contains(rel) else { continue }
        guard !seen.contains(canonicalKey(child.url)) else { continue }
        if hasDynamicExtension(in: child.url, extensionId: extensionId) {
          appendIfNew(
            child.url, displayName: dynamicDisplayName(leaf: child.name, parent: top.name))
        }
      }
    }

    return targets
  }

  /// Active-profile gate: `Local State` JSON with a `profile` dictionary, or `Default/Preferences`,
  /// or `Default/Secure Preferences`.
  static func isChromiumUserDataDirectory(_ directory: URL) -> Bool {
    if let json = readJSONObject(
      directory.appending(path: "Local State", directoryHint: .notDirectory)),
      json["profile"] is [String: Any]
    {
      return true
    }
    let defaultDir = directory.appending(path: "Default", directoryHint: .isDirectory)
    guard isRealDirectory(defaultDir) else { return false }
    return isRegularFile(defaultDir.appending(path: "Preferences", directoryHint: .notDirectory))
      || isRegularFile(
        defaultDir.appending(path: "Secure Preferences", directoryHint: .notDirectory))
  }

  private static func hasDynamicExtension(in directory: URL, extensionId: String) -> Bool {
    guard !extensionId.isEmpty, !extensionId.contains("/"), extensionId != ".", extensionId != ".."
    else { return false }
    guard
      let localState = readJSONObject(
        directory.appending(path: "Local State", directoryHint: .notDirectory)),
      let profile = localState["profile"] as? [String: Any],
      let infoCache = profile["info_cache"] as? [String: Any],
      !infoCache.isEmpty
    else { return false }

    let profileNames = infoCache.keys
      .filter { !$0.isEmpty && !$0.contains("/") && !$0.contains("..") && $0 != "." }
      .sorted()
      .prefix(maxDynamicProfiles)
    let needle = Data(extensionId.utf8)

    for name in profileNames {
      let profileDir = directory.appending(path: name, directoryHint: .isDirectory)
      guard isRealDirectory(profileDir) else { continue }

      let localExt =
        profileDir
        .appending(path: "Local Extension Settings", directoryHint: .isDirectory)
      if isRealDirectory(localExt),
        isRealDirectory(localExt.appending(path: extensionId, directoryHint: .isDirectory))
      {
        return true
      }

      for prefsName in ["Secure Preferences", "Preferences"] {
        let prefsFile = profileDir.appending(path: prefsName, directoryHint: .notDirectory)
        guard let data = readRegularFile(prefsFile), data.range(of: needle) != nil else {
          continue
        }
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let extensions = json["extensions"] as? [String: Any],
          let settings = extensions["settings"] as? [String: Any],
          settings[extensionId] is [String: Any]
        {
          return true
        }
      }
    }
    return false
  }

  private static func isExcludedTopName(_ name: String) -> Bool {
    let lower = name.lowercased()
    return excludedTopNames.contains(lower)
      || excludedTopPrefixes.contains { lower.hasPrefix($0) }
  }

  private static func dynamicDisplayName(leaf: String, parent: String?) -> String {
    let lower = leaf.lowercased()
    let chosen = (lower == "user data" || lower == "host") ? (parent ?? leaf) : leaf
    let clipped = chosen.clipped(toUTF16: 120)
    return clipped.isEmpty ? "Chromium" : clipped
  }

  private static func normalizedPath(_ url: URL) -> String {
    var path = url.standardizedFileURL.path(percentEncoded: false)
    while path.count > 1 && path.hasSuffix("/") {
      path.removeLast()
    }
    return path
  }

  private static func canonicalKey(_ url: URL) -> String {
    normalizedPath(url).lowercased()
  }

  private static func realPathChain(under root: URL, relative: String) -> URL? {
    var current = root
    for component in relative.split(separator: "/") {
      current = current.appending(path: String(component), directoryHint: .isDirectory)
      guard isRealDirectory(current) else { return nil }
    }
    return current
  }

  private static func realSubdirectories(of directory: URL) -> [(name: String, url: URL)] {
    guard
      let items = try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
    else { return [] }
    return items.compactMap { url -> (String, URL)? in
      let name = url.lastPathComponent
      guard !name.hasPrefix("."), isRealDirectory(url) else { return nil }
      return (name, url)
    }.sorted { $0.0 < $1.0 }
  }

  private static func isRealDirectory(_ url: URL) -> Bool {
    var status = stat()
    guard lstat(normalizedPath(url), &status) == 0 else { return false }
    return (status.st_mode & S_IFMT) == S_IFDIR
  }

  private static func isRegularFile(_ url: URL) -> Bool {
    var status = stat()
    guard lstat(normalizedPath(url), &status) == 0 else { return false }
    return (status.st_mode & S_IFMT) == S_IFREG
  }

  private static func readRegularFile(_ url: URL) -> Data? {
    var status = stat()
    guard lstat(normalizedPath(url), &status) == 0,
      (status.st_mode & S_IFMT) == S_IFREG,
      status.st_size >= 0, status.st_size <= maxMetadataBytes,
      let data = try? Data(contentsOf: url),
      Int64(data.count) <= maxMetadataBytes
    else { return nil }
    return data
  }

  private static func readJSONObject(_ url: URL) -> [String: Any]? {
    guard let data = readRegularFile(url) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
}
