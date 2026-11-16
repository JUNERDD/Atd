import AICore
import AppKit

/// Thread-safe, count-bounded LRU cache for resolved `NSFont` instances and their family keys.
nonisolated final class CaptureFontCacheBox: @unchecked Sendable {
  private struct Entry {
    let key: String
    let familyKey: String
    let font: NSFont
  }

  private let lock = NSLock()
  private var entries: [Entry] = []
  private let countLimit: Int

  init(countLimit: Int) { self.countLimit = countLimit }

  func font(forKey key: String) -> NSFont? {
    lock.withLock {
      guard let index = entries.firstIndex(where: { $0.key == key }) else { return nil }
      if index != entries.count - 1 {
        let entry = entries.remove(at: index)
        entries.append(entry)
      }
      return entries[entries.count - 1].font
    }
  }

  func setFont(_ font: NSFont, forKey key: String, familyKey: String) {
    lock.withLock {
      entries.removeAll { $0.key == key }
      entries.append(Entry(key: key, familyKey: familyKey, font: font))
      if entries.count > countLimit {
        entries.removeFirst(entries.count - countLimit)
      }
    }
  }

  func remove(familyKey: String) {
    lock.withLock { entries.removeAll { $0.familyKey == familyKey } }
  }

  func removeAll() {
    lock.withLock { entries.removeAll() }
  }

  func cachedFamilyKeys() -> Set<String> {
    lock.withLock { Set(entries.compactMap { $0.familyKey.isEmpty ? nil : $0.familyKey }) }
  }
}

/// Localized category labels shown for curated Google Fonts in the picker.
enum CaptureFontCategory: CaseIterable, Sendable {
  case sans
  case serif
  case mono
  case handwriting
  case cjk

  nonisolated var stringKey: CaptureToolsStringKey {
    switch self {
    case .sans: .fontCategorySans
    case .serif: .fontCategorySerif
    case .mono: .fontCategoryMono
    case .handwriting: .fontCategoryHandwriting
    case .cjk: .fontCategoryCJK
    }
  }

  var localizedTitle: String { ShellStrings.shared.text(stringKey) }
}

struct CaptureGoogleFontSpec: Equatable, Sendable {
  let family: String
  let category: CaptureFontCategory
}

enum CaptureGoogleFontStatus: Equatable {
  case remote
  case loading
  case cached
  case failed
}

enum CaptureFontTab: Int, CaseIterable {
  case curated
  case google
  case local
  case recent
}

enum CaptureFontEmptyReason: Equatable {
  case recent
  case search
}

enum CaptureFontPickerItem: Equatable {
  case systemDefault
  case font(family: String, displayTitle: String, badge: String?, isGoogle: Bool)
  case loadCustomGoogle(String)
  case empty(CaptureFontEmptyReason)
}
