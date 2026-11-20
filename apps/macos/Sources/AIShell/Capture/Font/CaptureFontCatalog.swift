import AICore
import AppKit
import CoreText

/// Thread-safe, memory-bounded font resolver and lazy local-family index for screenshot text.
/// Never eagerly instantiates `NSFont` across all installed families.
@MainActor
final class CaptureFontCatalog {
  nonisolated static let shared = CaptureFontCatalog()

  nonisolated static let curatedGoogle: [CaptureGoogleFontSpec] = [
    CaptureGoogleFontSpec(family: "Inter", category: .sans),
    CaptureGoogleFontSpec(family: "Plus Jakarta Sans", category: .sans),
    CaptureGoogleFontSpec(family: "Space Grotesk", category: .sans),
    CaptureGoogleFontSpec(family: "DM Sans", category: .sans),
    CaptureGoogleFontSpec(family: "Manrope", category: .sans),
    CaptureGoogleFontSpec(family: "Outfit", category: .sans),
    CaptureGoogleFontSpec(family: "Playfair Display", category: .serif),
    CaptureGoogleFontSpec(family: "Instrument Serif", category: .serif),
    CaptureGoogleFontSpec(family: "Lora", category: .serif),
    CaptureGoogleFontSpec(family: "Newsreader", category: .serif),
    CaptureGoogleFontSpec(family: "JetBrains Mono", category: .mono),
    CaptureGoogleFontSpec(family: "Fira Code", category: .mono),
    CaptureGoogleFontSpec(family: "IBM Plex Mono", category: .mono),
    CaptureGoogleFontSpec(family: "Space Mono", category: .mono),
    CaptureGoogleFontSpec(family: "Caveat", category: .handwriting),
    CaptureGoogleFontSpec(family: "Kalam", category: .handwriting),
    CaptureGoogleFontSpec(family: "Permanent Marker", category: .handwriting),
    CaptureGoogleFontSpec(family: "Patrick Hand", category: .handwriting),
    CaptureGoogleFontSpec(family: "Architects Daughter", category: .handwriting),
    CaptureGoogleFontSpec(family: "Noto Sans SC", category: .cjk),
    CaptureGoogleFontSpec(family: "Noto Serif SC", category: .cjk),
    CaptureGoogleFontSpec(family: "ZCOOL KuaiLe", category: .cjk),
    CaptureGoogleFontSpec(family: "Ma Shan Zheng", category: .cjk),
    CaptureGoogleFontSpec(family: "ZCOOL XiaoWei", category: .cjk),
  ]

  nonisolated static let curatedLocalPicks: [String] = [
    "PingFang SC", "Helvetica Neue", "Avenir Next", "Menlo", "SF Mono", "Hiragino Sans",
  ]

  private nonisolated static let localizedFamilyTitles: [String: String] = [
    "pingfang sc": "苹方 · PingFang SC",
    "pingfang tc": "蘋方 · PingFang TC",
    "hiragino sans": "冬青黑体 · Hiragino Sans",
    "songti sc": "宋体 · Songti SC",
    "kaiti sc": "楷体 · Kaiti SC",
    "heiti sc": "黑体 · Heiti SC",
    "yuanti sc": "圆体 · Yuanti SC",
    "lxgw wenkai": "霞鹜文楷 · LXGW WenKai",
    "noto sans sc": "思源黑体 · Noto Sans SC",
    "noto serif sc": "思源宋体 · Noto Serif SC",
    "zcool kuaile": "站酷快乐体 · ZCOOL KuaiLe",
    "ma shan zheng": "马善政毛笔 · Ma Shan Zheng",
    "zcool xiaowei": "站酷小薇体 · ZCOOL XiaoWei",
  ]

  private nonisolated static let curatedKeys: Set<String> = Set(
    curatedGoogle.map { $0.family.lowercased() }
  )

  private nonisolated let renderFontCache = CaptureFontCacheBox(countLimit: 24)
  private nonisolated let previewFontCache = CaptureFontCacheBox(countLimit: 36)
  private var cachedLocalFamilies: [String]?

  /// Fires when an async Google Font download finishes registering in `.process` scope.
  var onFontRegistered: ((String) -> Void)?

  private nonisolated init() {}

  private nonisolated static func normalizedKey(_ family: String) -> String {
    family.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  nonisolated func cachedFamilyKeys() -> Set<String> {
    renderFontCache.cachedFamilyKeys().union(previewFontCache.cachedFamilyKeys())
  }

  nonisolated func isCuratedGoogle(_ family: String) -> Bool {
    Self.curatedKeys.contains(Self.normalizedKey(family))
  }

  nonisolated func googleCategory(for family: String) -> CaptureFontCategory? {
    let key = Self.normalizedKey(family)
    return Self.curatedGoogle.first { $0.family.lowercased() == key }?.category
  }

  nonisolated func displayTitle(for family: String) -> String {
    let trimmed = family.trimmingCharacters(in: .whitespacesAndNewlines)
    return Self.localizedFamilyTitles[trimmed.lowercased()] ?? trimmed
  }

  nonisolated func font(family: String?, size: CGFloat, weight: NSFont.Weight = .semibold) -> NSFont
  {
    let trimmed = family?.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalized = (trimmed?.isEmpty == false) ? trimmed : nil
    let key = "\(normalized ?? "")|\(Int((size * 10).rounded()))|\(weight.rawValue)"
    if let cached = renderFontCache.font(forKey: key) { return cached }

    guard let resolvedFamily = normalized else {
      let sys = Self.systemFont(size: size, weight: weight)
      renderFontCache.setFont(sys, forKey: key, familyKey: "")
      return sys
    }
    let familyKey = Self.normalizedKey(resolvedFamily)
    return CaptureGoogleFontLoader.shared.withPinnedFamily(resolvedFamily) {
      if let installed = Self.resolveInstalledFont(
        family: resolvedFamily, size: size, weight: weight)
      {
        CaptureGoogleFontLoader.shared.touchProcessRegistrationIfPresent(family: resolvedFamily)
        renderFontCache.setFont(installed, forKey: key, familyKey: familyKey)
        return installed
      }
      if let canonical = CaptureGoogleFontLoader.shared.registerCachedFont(family: resolvedFamily),
        let hydrated =
          Self.resolveInstalledFont(family: resolvedFamily, size: size, weight: weight)
          ?? Self.resolveInstalledFont(family: canonical, size: size, weight: weight)
      {
        renderFontCache.setFont(hydrated, forKey: key, familyKey: Self.normalizedKey(canonical))
        return hydrated
      }
      if isCuratedGoogle(resolvedFamily) {
        Task { @MainActor in
          _ = await CaptureGoogleFontLoader.shared.loadFontIfNotFailed(family: resolvedFamily)
        }
      }
      return Self.systemFont(size: size, weight: weight)
    }
  }

  func displayLabel(for family: String?) -> String {
    let trimmed = family?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if trimmed.isEmpty { return ShellStrings.shared.text(CaptureToolsStringKey.fontSystemLabel) }
    return trimmed
  }

  /// Lazily queries CoreText family names only when the font picker opens.
  func localFontFamilies() -> [String] {
    if let cached = cachedLocalFamilies { return cached }
    let raw = (CTFontManagerCopyAvailableFontFamilyNames() as? [String]) ?? []
    var seen = Set<String>()
    let sorted =
      raw
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && !$0.hasPrefix(".") && seen.insert($0.lowercased()).inserted }
      .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    cachedLocalFamilies = sorted
    return sorted
  }

  /// Returns a bounded preview font for visible table cells if locally available.
  func previewFont(for family: String, size: CGFloat = 14) -> NSFont? {
    let key = "\(family)|\(Int((size * 10).rounded()))"
    if let cached = previewFontCache.font(forKey: key) { return cached }
    return CaptureGoogleFontLoader.shared.withPinnedFamily(family) {
      guard let font = Self.resolveInstalledFont(family: family, size: size, weight: .regular)
      else { return nil }
      previewFontCache.setFont(font, forKey: key, familyKey: Self.normalizedKey(family))
      return font
    }
  }

  func isLocallyAvailable(_ family: String) -> Bool {
    localFontFamilies().contains { $0.caseInsensitiveCompare(family) == .orderedSame }
  }

  func clearPreviewCache() { previewFontCache.removeAll() }

  func invalidateCaches() {
    renderFontCache.removeAll()
    previewFontCache.removeAll()
    cachedLocalFamilies = nil
  }

  func notifyFontRegistered(_ family: String) {
    let familyKey = Self.normalizedKey(family)
    renderFontCache.remove(familyKey: familyKey)
    previewFontCache.remove(familyKey: familyKey)
    cachedLocalFamilies = nil
    onFontRegistered?(family)
  }

  func pickerItems(tab: CaptureFontTab, query: String, recent: [String]) -> [CaptureFontPickerItem]
  {
    let strings = ShellStrings.shared
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let localSet = Set(localFontFamilies().map { $0.lowercased() })
    let localBadge = strings.text(CaptureToolsStringKey.fontBadgeLocal)
    var items: [CaptureFontPickerItem] = []

    switch tab {
    case .curated:
      items.append(.systemDefault)
      for pick in Self.curatedLocalPicks where localSet.contains(pick.lowercased()) {
        items.append(fontItem(pick, badge: localBadge, isGoogle: false))
      }
      for spec in Self.curatedGoogle {
        let isGoogle = !localSet.contains(spec.family.lowercased())
        items.append(fontItem(spec.family, badge: spec.category.localizedTitle, isGoogle: isGoogle))
      }
    case .google:
      for spec in Self.curatedGoogle {
        let isGoogle = !localSet.contains(spec.family.lowercased())
        items.append(fontItem(spec.family, badge: spec.category.localizedTitle, isGoogle: isGoogle))
      }
    case .local:
      for family in localFontFamilies() {
        items.append(fontItem(family, badge: nil, isGoogle: false))
      }
    case .recent:
      for family in recent {
        let isLocal = localSet.contains(family.lowercased())
        let isGoogle =
          !isLocal
          && (isCuratedGoogle(family)
            || CaptureGoogleFontLoader.shared.cachedFileURL(for: family) != nil)
        let badge = googleCategory(for: family)?.localizedTitle ?? (isLocal ? localBadge : nil)
        items.append(fontItem(family, badge: badge, isGoogle: isGoogle))
      }
    }

    if !trimmed.isEmpty {
      items = items.filter { matchesQuery($0, query: trimmed) }
      if tab == .curated || tab == .google {
        let hasExact = items.contains {
          if case .font(let f, _, _, _) = $0 {
            return f.caseInsensitiveCompare(trimmed) == .orderedSame
          }
          return false
        }
        let matchesSystemExact = tab == .curated && isExactSystemDefaultQuery(trimmed)
        if !hasExact && !matchesSystemExact && !localSet.contains(trimmed.lowercased()) {
          items.append(.loadCustomGoogle(trimmed))
        }
      }
      if items.isEmpty { items = [.empty(.search)] }
    } else if items.isEmpty {
      items = [.empty(tab == .recent ? .recent : .search)]
    }
    return items
  }

  private func fontItem(_ family: String, badge: String?, isGoogle: Bool) -> CaptureFontPickerItem {
    .font(family: family, displayTitle: displayTitle(for: family), badge: badge, isGoogle: isGoogle)
  }

  private func matchesQuery(_ item: CaptureFontPickerItem, query: String) -> Bool {
    switch item {
    case .systemDefault:
      return systemDefaultCandidates().contains { $0.localizedCaseInsensitiveContains(query) }
    case .font(let family, let displayTitle, _, _):
      return family.localizedCaseInsensitiveContains(query)
        || displayTitle.localizedCaseInsensitiveContains(query)
    case .loadCustomGoogle, .empty:
      return false
    }
  }

  private func isExactSystemDefaultQuery(_ query: String) -> Bool {
    systemDefaultCandidates().contains { $0.caseInsensitiveCompare(query) == .orderedSame }
  }

  private func systemDefaultCandidates() -> [String] {
    let strings = ShellStrings.shared
    return [
      strings.text(CaptureToolsStringKey.fontSystemDefault),
      strings.text(CaptureToolsStringKey.fontSystemLabel),
      "System Default (SF Pro)",
      "System Default",
      "SF Pro",
    ]
  }

  private nonisolated static func systemFont(size: CGFloat, weight: NSFont.Weight) -> NSFont {
    let traits: [CFString: Any] = [kCTFontWeightTrait: weight.rawValue]
    let descriptor = CTFontDescriptorCreateWithAttributes(
      [kCTFontTraitsAttribute: traits as CFDictionary] as CFDictionary)
    if let base = CTFontCreateUIFontForLanguage(.system, size, nil) {
      return CTFontCreateCopyWithAttributes(base, size, nil, descriptor) as NSFont
    }
    return NSFont.systemFont(ofSize: size, weight: weight)
  }

  private nonisolated static func resolveInstalledFont(
    family: String, size: CGFloat, weight: NSFont.Weight
  ) -> NSFont? {
    let traits: [CFString: Any] = [kCTFontWeightTrait: weight.rawValue]
    let attrs: [CFString: Any] = [
      kCTFontFamilyNameAttribute: family,
      kCTFontTraitsAttribute: traits as CFDictionary,
    ]
    let descriptor = CTFontDescriptorCreateWithAttributes(attrs as CFDictionary)
    var ctFont = CTFontCreateWithFontDescriptor(descriptor, size, nil)
    let resolvedFamily = CTFontCopyFamilyName(ctFont) as String
    guard resolvedFamily.caseInsensitiveCompare(family) == .orderedSame else { return nil }
    if weight.rawValue >= 0.2 {
      let symbolic = CTFontGetSymbolicTraits(ctFont)
      let currentWeight =
        ((CTFontCopyTraits(ctFont) as? [CFString: Any])?[kCTFontWeightTrait] as? NSNumber)?
        .doubleValue ?? 0
      if !symbolic.contains(.traitBold), currentWeight < 0.2,
        let bold = CTFontCreateCopyWithSymbolicTraits(ctFont, size, nil, .traitBold, .traitBold),
        (CTFontCopyFamilyName(bold) as String).caseInsensitiveCompare(family) == .orderedSame
      {
        ctFont = bold
      }
    }
    return ctFont as NSFont
  }
}
