import AppKit
import CoreText
import Foundation
import os

/// Memory-safe on-demand Google Fonts downloader and `.process`-scoped CoreText registrar.
/// Never touches `~/Library/Fonts` and enforces both a 50 MB disk LRU and a 12-font process LRU.
@MainActor
final class CaptureGoogleFontLoader {
  nonisolated static let shared = CaptureGoogleFontLoader()

  nonisolated static let maxDiskBytes: Int64 = 50 * 1024 * 1024
  nonisolated static let maxDownloadBytes = 15 * 1024 * 1024
  private nonisolated static let maxRegisteredProcessFonts = 12
  private nonisolated static let fontExtensions = ["ttf", "otf", "ttc"]

  private nonisolated struct RegisteredEntry: Sendable {
    let key: String
    let family: String
    let url: URL
  }

  private nonisolated struct RegistryState: Sendable {
    var registeredLRU: [RegisteredEntry] = []
    var canonicalByKey: [String: String] = [:]
    var pinnedRenderCounts: [String: Int] = [:]
  }

  var activeFamiliesProvider: (() -> Set<String>)?
  var onStatusChanged: ((String) -> Void)?

  private nonisolated let registry = OSAllocatedUnfairLock(initialState: RegistryState())
  private var inFlightTasks: [String: Task<String?, Never>] = [:]
  private var failedKeys: Set<String> = []

  private nonisolated init() {}

  nonisolated static var cacheDirectory: URL {
    let base =
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    return
      base
      .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.junerdd.ai", isDirectory: true)
      .appendingPathComponent("capture-fonts", isDirectory: true)
  }

  private nonisolated static func normalizedKey(_ family: String) -> String {
    family.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  private nonisolated static func slug(for family: String) -> String {
    let allowed = CharacterSet.alphanumerics
    let scalars = normalizedKey(family).unicodeScalars.map {
      allowed.contains($0) ? Character($0) : "-"
    }
    let collapsed = String(scalars).split(separator: "-").joined(separator: "-")
    return collapsed.isEmpty ? "font" : collapsed
  }

  nonisolated func cachedFileURL(for family: String) -> URL? {
    let slug = Self.slug(for: family)
    let dir = Self.cacheDirectory
    for ext in Self.fontExtensions {
      let url = dir.appendingPathComponent("\(slug).\(ext)", isDirectory: false)
      if FileManager.default.fileExists(atPath: url.path) { return url }
    }
    return nil
  }

  /// Pins `family` for the duration of `body` so background rendering cannot lose its `.process` font.
  nonisolated func withPinnedFamily<T>(_ family: String?, _ body: () -> T) -> T {
    guard let family else { return body() }
    let trimmed = family.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return body() }
    return withPinnedFamilies([trimmed], body)
  }

  /// Pins all `families` for the duration of `body` against `.process` font unregistration.
  nonisolated func withPinnedFamilies<T>(_ families: Set<String>, _ body: () -> T) -> T {
    let keys = Set(families.map { Self.normalizedKey($0) }.filter { !$0.isEmpty })
    guard !keys.isEmpty else { return body() }
    let pinnedKeys: [String] = registry.withLock { state in
      var expanded = Set<String>()
      for key in keys {
        expanded.insert(key)
        if let canonical = state.canonicalByKey[key] {
          expanded.insert(Self.normalizedKey(canonical))
        }
      }
      for key in expanded { state.pinnedRenderCounts[key, default: 0] += 1 }
      return Array(expanded)
    }
    defer {
      registry.withLock { state in
        for key in pinnedKeys {
          let next = (state.pinnedRenderCounts[key] ?? 0) - 1
          if next > 0 {
            state.pinnedRenderCounts[key] = next
          } else {
            state.pinnedRenderCounts.removeValue(forKey: key)
          }
        }
      }
    }
    return body()
  }

  /// Moves `family` to the MRU tail when already registered in `.process` scope.
  nonisolated func touchProcessRegistrationIfPresent(family: String) {
    let key = Self.normalizedKey(family)
    guard !key.isEmpty else { return }
    registry.withLock { state in
      let resolvedKey = state.canonicalByKey[key].map { Self.normalizedKey($0) } ?? key
      guard let idx = state.registeredLRU.firstIndex(where: { $0.key == resolvedKey }) else {
        return
      }
      if idx != state.registeredLRU.count - 1 {
        let entry = state.registeredLRU.remove(at: idx)
        state.registeredLRU.append(entry)
      }
    }
  }

  /// Registers a font that is already cached on disk synchronously in `.process` scope.
  nonisolated func registerCachedFontIfPresent(family: String) -> Bool {
    registerCachedFont(family: family) != nil
  }

  /// Registers a cached font file synchronously under `registry` and returns its canonical family.
  nonisolated func registerCachedFont(family: String) -> String? {
    let lookupKey = Self.normalizedKey(family)
    guard !lookupKey.isEmpty else { return nil }
    let result: (canonical: String?, needsPrune: Bool) = registry.withLock { state in
      let resolvedKey = state.canonicalByKey[lookupKey].map { Self.normalizedKey($0) } ?? lookupKey
      if let idx = state.registeredLRU.firstIndex(where: { $0.key == resolvedKey }),
        FileManager.default.fileExists(atPath: state.registeredLRU[idx].url.path)
      {
        let entry = state.registeredLRU.remove(at: idx)
        state.registeredLRU.append(entry)
        return (entry.family, state.registeredLRU.count > Self.maxRegisteredProcessFonts)
      }
      guard let url = cachedFileURL(for: family), Self.registerProcessFontURLSync(url) else {
        return (nil, false)
      }
      let canonical =
        state.canonicalByKey[lookupKey] ?? Self.extractFamilyName(from: url) ?? family
      let canonicalKey = Self.normalizedKey(canonical)
      state.canonicalByKey[lookupKey] = canonical
      state.canonicalByKey[canonicalKey] = canonical
      state.registeredLRU.removeAll { $0.key == canonicalKey }
      state.registeredLRU.append(RegisteredEntry(key: canonicalKey, family: canonical, url: url))
      return (canonical, state.registeredLRU.count > Self.maxRegisteredProcessFonts)
    }
    if result.needsPrune {
      Task { @MainActor in self.pruneUnusedProcessRegistrations() }
    }
    return result.canonical
  }

  func status(for family: String) -> CaptureGoogleFontStatus {
    let key = Self.normalizedKey(family)
    if inFlightTasks[key] != nil { return .loading }
    let registered = registry.withLock { state in
      let resolvedKey = state.canonicalByKey[key].map { Self.normalizedKey($0) } ?? key
      return state.registeredLRU.contains { $0.key == resolvedKey }
    }
    if registered || cachedFileURL(for: family) != nil { return .cached }
    return failedKeys.contains(key) ? .failed : .remote
  }

  func loadFontIfNotFailed(family: String) async -> String? {
    guard !failedKeys.contains(Self.normalizedKey(family)) else { return nil }
    return await loadFont(family: family)
  }

  /// Downloads (if uncached), validates, caches to disk, and registers in `.process` scope.
  func loadFont(family: String) async -> String? {
    let trimmed = family.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let key = Self.normalizedKey(trimmed)
    if let existing = inFlightTasks[key] { return await existing.value }

    failedKeys.remove(key)
    onStatusChanged?(trimmed)

    let task = Task<String?, Never> { [weak self] in
      guard let self else { return nil }
      return await self.performLoad(family: trimmed, key: key)
    }
    inFlightTasks[key] = task
    let resolved = await task.value
    inFlightTasks[key] = nil
    onStatusChanged?(resolved ?? trimmed)
    return resolved
  }

  private func performLoad(family: String, key: String) async -> String? {
    if let cachedURL = cachedFileURL(for: family) {
      try? FileManager.default.setAttributes(
        [.modificationDate: Date()], ofItemAtPath: cachedURL.path)
      if let registered = await registerURLInProcess(cachedURL, fallbackFamily: family) {
        return registered
      }
    }
    guard let downloaded = await Self.downloadFontData(family: family) else {
      failedKeys.insert(key)
      return nil
    }
    let dest = Self.cacheDirectory.appendingPathComponent(
      "\(Self.slug(for: downloaded.family)).\(downloaded.ext)")
    let wrote = await writeAndEvictDiskCache(downloaded.data, to: dest)
    if wrote, let registered = await registerURLInProcess(dest, fallbackFamily: downloaded.family) {
      return registered
    }
    failedKeys.insert(key)
    return nil
  }

  @concurrent
  private nonisolated func writeAndEvictDiskCache(_ data: Data, to dest: URL) async -> Bool {
    registry.withLock { state in
      do {
        try FileManager.default.createDirectory(
          at: Self.cacheDirectory, withIntermediateDirectories: true)
        try data.write(to: dest, options: .atomic)
        let protected = Set(state.registeredLRU.map { $0.url.standardizedFileURL }).union([
          dest.standardizedFileURL
        ])
        Self.evictDiskCacheIfNeeded(keeping: protected)
        return true
      } catch {
        return false
      }
    }
  }

  private func registerURLInProcess(_ url: URL, fallbackFamily: String) async -> String? {
    guard let canonical = await registerURLAtomically(url, fallbackFamily: fallbackFamily) else {
      return nil
    }
    pruneUnusedProcessRegistrations()
    CaptureFontCatalog.shared.notifyFontRegistered(canonical)
    return canonical
  }

  @concurrent
  private nonisolated func registerURLAtomically(_ url: URL, fallbackFamily: String) async
    -> String?
  {
    let fallbackKey = Self.normalizedKey(fallbackFamily)
    return registry.withLock { state in
      let known = state.canonicalByKey[fallbackKey]
      let knownKey = known.map { Self.normalizedKey($0) }
      if let known, let knownKey, state.registeredLRU.contains(where: { $0.key == knownKey }) {
        state.registeredLRU.removeAll { $0.key == knownKey }
        state.registeredLRU.append(RegisteredEntry(key: knownKey, family: known, url: url))
        return known
      }
      let ok = Self.registerProcessFontURLSync(url)
      let extracted = Self.extractFamilyName(from: url)
      if !ok, extracted == nil { return nil }
      let canonical = known ?? extracted ?? fallbackFamily
      let key = Self.normalizedKey(canonical)
      state.canonicalByKey[fallbackKey] = canonical
      state.canonicalByKey[key] = canonical
      state.registeredLRU.removeAll { $0.key == key }
      state.registeredLRU.append(RegisteredEntry(key: key, family: canonical, url: url))
      return canonical
    }
  }

  private nonisolated static func registerProcessFontURLSync(_ url: URL) -> Bool {
    var error: Unmanaged<CFError>?
    let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
    if ok { return true }
    if let err = error?.takeRetainedValue() {
      let nsErr = (err as Error) as NSError
      return nsErr.domain == (kCTFontManagerErrorDomain as String)
        && nsErr.code == CTFontManagerError.alreadyRegistered.rawValue
    }
    return false
  }

  private func pruneUnusedProcessRegistrations() {
    let active = Set((activeFamiliesProvider?() ?? []).map { Self.normalizedKey($0) })
    let cached = CaptureFontCatalog.shared.cachedFamilyKeys()
    registry.withLock { state in
      var protected = active.union(cached).union(state.pinnedRenderCounts.keys)
      for key in Array(protected) {
        if let canonical = state.canonicalByKey[key] {
          protected.insert(Self.normalizedKey(canonical))
        }
      }
      var skipped = Set<String>()
      while state.registeredLRU.count > Self.maxRegisteredProcessFonts {
        guard
          let idx = state.registeredLRU.firstIndex(where: { entry in
            !protected.contains(entry.key) && !skipped.contains(entry.key)
          })
        else { break }
        let victim = state.registeredLRU[idx]
        var unregError: Unmanaged<CFError>?
        var canRemove = CTFontManagerUnregisterFontsForURL(
          victim.url as CFURL, .process, &unregError)
        if !canRemove, let err = unregError?.takeRetainedValue() {
          let nsErr = (err as Error) as NSError
          canRemove =
            nsErr.domain == (kCTFontManagerErrorDomain as String)
            && nsErr.code == CTFontManagerError.notRegistered.rawValue
        }
        if canRemove {
          state.registeredLRU.remove(at: idx)
        } else {
          skipped.insert(victim.key)
        }
      }
    }
  }

  private nonisolated static func extractFamilyName(from url: URL) -> String? {
    guard
      let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL)
        as? [CTFontDescriptor],
      let first = descriptors.first
    else { return nil }
    return CTFontDescriptorCopyAttribute(first, kCTFontFamilyNameAttribute) as? String
  }
}
