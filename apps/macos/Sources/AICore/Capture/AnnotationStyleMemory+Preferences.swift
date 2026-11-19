import Foundation

extension AnnotationStyleMemory {
  private static let recentColorsKey = prefix + "recentColors"
  private static let recentFontsKey = prefix + "recentFonts"
  private static let maxRecentCount = 8

  /// Returns up to 8 most recently used custom colors in MRU order.
  public static func loadRecentColors(from defaults: UserDefaults = .standard) -> [AnnotationRGBA] {
    guard let stored = defaults.array(forKey: recentColorsKey) as? [[Double]] else { return [] }
    return stored.prefix(maxRecentCount).compactMap { tuple in
      guard tuple.count >= 3 else { return nil }
      let alpha = tuple.count >= 4 ? tuple[3] : 1.0
      return AnnotationRGBA(red: tuple[0], green: tuple[1], blue: tuple[2], alpha: alpha)
    }
  }

  /// Prepends `color` to recent colors, deduplicated at 8-bit precision and capped at 8 entries.
  public static func recordRecentColor(
    _ color: AnnotationRGBA, to defaults: UserDefaults = .standard
  ) {
    func quantize(_ c: AnnotationRGBA) -> [Int] {
      [
        Int((c.red * 255).rounded()), Int((c.green * 255).rounded()),
        Int((c.blue * 255).rounded()), Int((c.alpha * 255).rounded()),
      ]
    }
    let target = quantize(color)
    var updated = loadRecentColors(from: defaults).filter { quantize($0) != target }
    updated.insert(color, at: 0)
    if updated.count > maxRecentCount { updated = Array(updated.prefix(maxRecentCount)) }
    defaults.set(updated.map { [$0.red, $0.green, $0.blue, $0.alpha] }, forKey: recentColorsKey)
  }

  /// Returns up to 8 most recently used font family names in MRU order.
  public static func loadRecentFonts(from defaults: UserDefaults = .standard) -> [String] {
    let stored = defaults.stringArray(forKey: recentFontsKey) ?? []
    return Array(
      stored.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .prefix(maxRecentCount))
  }

  /// Prepends `family` to recent font families, deduplicated case-insensitively and capped at 8.
  public static func recordRecentFont(
    _ family: String, to defaults: UserDefaults = .standard
  ) {
    let trimmed = family.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    var updated = loadRecentFonts(from: defaults).filter {
      $0.caseInsensitiveCompare(trimmed) != .orderedSame
    }
    updated.insert(trimmed, at: 0)
    if updated.count > maxRecentCount { updated = Array(updated.prefix(maxRecentCount)) }
    defaults.set(updated, forKey: recentFontsKey)
  }
}

/// Persists the screenshot cutout corner radius (`0...maxRadius` points) across capture sessions.
public enum CaptureCornerRadiusMemory {
  private static let key = "capture.screenshot.cornerRadius"
  public static let maxRadius: CGFloat = 64

  public static func load(from defaults: UserDefaults = .standard) -> CGFloat {
    guard let stored = defaults.object(forKey: key) as? NSNumber else { return 0 }
    let value = CGFloat(stored.doubleValue)
    guard value.isFinite else { return 0 }
    return min(max(0, value), maxRadius)
  }

  public static func save(_ radius: CGFloat, to defaults: UserDefaults = .standard) {
    let clamped = radius.isFinite ? min(max(0, radius), maxRadius) : 0
    defaults.set(Double(clamped), forKey: key)
  }
}
