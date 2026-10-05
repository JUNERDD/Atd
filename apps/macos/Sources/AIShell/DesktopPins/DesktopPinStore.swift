import AICore
import AIWidgetModel
import CryptoKit
import Foundation
import OSLog

/// What a desktop pin shows: one declared widget in one family, or the app's tile, which an app
/// without widgets always shows: small (its icon and name) or medium (its icon beside the name
/// and the app's description).
enum DesktopPinFace: Equatable, Sendable {
  case widget(id: String, family: WidgetFamily)
  /// Always in one of ``tileFamilies``.
  case tile(family: WidgetFamily)

  /// The sizes a tile comes in, smallest first.
  static let tileFamilies: [WidgetFamily] = [.systemSmall, .systemMedium]

  /// The shown widget's id; nil for the tile.
  var widgetId: String? {
    guard case .widget(let id, _) = self else { return nil }
    return id
  }

  var family: WidgetFamily {
    switch self {
    case .widget(_, let family), .tile(let family): family
    }
  }

  /// The same widget, or the tile, in `family`.
  func with(family: WidgetFamily) -> DesktopPinFace {
    switch self {
    case .widget(let id, _): .widget(id: id, family: family)
    case .tile: .tile(family: family)
    }
  }
}

/// One app's desktop pin as the shell keeps it: what the user chose it to show, its size, and its
/// place as the display (`CGDisplayCreateUUIDFromDisplayID`) and the top-left offset in that
/// display's work area. Fallbacks the shell applies while showing it (a widget the app no longer
/// declares, a display that is gone, a size its layouts do not reach) never rewrite the record, so
/// the pin returns once the cause goes away.
struct DesktopPinRecord: Equatable, Sendable {
  let appId: String
  /// The widget, or the tile, and the family it last showed.
  var face: DesktopPinFace
  var display: String?
  var offset: DesktopPinGeometry.Offset
  /// The size a resize left; nil keeps the face's family size, as a size from the menu does.
  var size: WindowSize? = nil
}

/// The desktop pins of one service data directory, in a JSON file of the shell's
/// (`~/Library/Application Support/<host bundle id>/desktop-pins/<key>.json`, beside the widget
/// files). The key is the first 16 hex digits of the SHA-256 of the standardized data directory
/// path: a Debug app run with a temporary `AI_AGENT_DATA_DIR` shares the bundle id, and must
/// neither show nor, through its deletion checks, erase the pins of the user's own data.
///
/// Reading is bounded and forgiving: at most 64 KiB, only `version` 1, each entry checked on its
/// own (ids against the contract's patterns; a widget with its family, the tile with a tile family
/// or none, which is small; a size as both `w` and `h` or neither) and dropped when invalid,
/// duplicates of an app dropped, and at most ``limit`` pins kept. Writes are atomic, and leave
/// out `w` and `h` for a pin at its family size, so earlier files and builds read the same.
struct DesktopPinStore {
  static let limit = 24
  private static let maxBytes = 64 * 1024
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "desktop-pins")

  let url: URL
  private let dataDirectory: String

  /// Nil outside an app (no widget files).
  init?(files: WidgetFiles?, dataDirectory: URL) {
    guard let files else { return nil }
    let path = dataDirectory.standardizedFileURL.path(percentEncoded: false)
    let digest = SHA256.hash(data: Data(path.utf8)).prefix(8)
    let key = digest.map { String(format: "%02x", $0) }.joined()
    url = files.directory.deletingLastPathComponent()
      .appending(path: "desktop-pins", directoryHint: .isDirectory)
      .appending(path: "\(key).json")
    self.dataDirectory = path
  }

  func load() -> [DesktopPinRecord] {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return [] }
    defer { try? handle.close() }
    guard let data = try? handle.read(upToCount: Self.maxBytes + 1), data.count <= Self.maxBytes,
      let file = try? JSONDecoder().decode(StoredFile.self, from: data), file.version == 1
    else {
      Self.log.error("Ignored a desktop pins file that is too large or does not decode.")
      return []
    }
    var seen: Set<String> = []
    return file.pins.compactMap(\.record).filter { seen.insert($0.appId).inserted }
      .prefix(Self.limit).map { $0 }
  }

  func save(_ records: [DesktopPinRecord]) {
    let file = StoredFile(
      version: 1, dataDirectory: dataDirectory, pins: records.map(StoredPin.init(record:)))
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(file).write(to: url, options: .atomic)
    } catch {
      Self.log.error("Desktop pins were not saved: \(String(describing: error), privacy: .public)")
    }
  }
}

/// The file's JSON: `{version, dataDirectory, pins: [{appId, widgetId, family, display, x, y,
/// w?, h?}]}`.
private struct StoredFile: Codable {
  let version: Int
  let dataDirectory: String
  let pins: [StoredPin]
}

private struct StoredPin: Codable {
  let appId: String
  let widgetId: String?
  let family: String?
  let display: String?
  let x: Double
  let y: Double
  let w: Double?
  let h: Double?

  init(record: DesktopPinRecord) {
    appId = record.appId
    switch record.face {
    case .widget(let id, let family): (widgetId, self.family) = (id, family.rawValue)
    case .tile(let family): (widgetId, self.family) = (nil, Self.tileFamily(family))
    }
    display = record.display
    x = record.offset.x
    y = record.offset.y
    w = record.size?.width
    h = record.size?.height
  }

  /// A malformed entry decodes as nil instead of failing the whole file.
  init(from decoder: any Decoder) throws {
    let container = try? decoder.container(keyedBy: CodingKeys.self)
    appId = (try? container?.decode(String.self, forKey: .appId)) ?? ""
    widgetId = try? container?.decodeIfPresent(String.self, forKey: .widgetId)
    family = try? container?.decodeIfPresent(String.self, forKey: .family)
    display = try? container?.decodeIfPresent(String.self, forKey: .display)
    x = (try? container?.decode(Double.self, forKey: .x)) ?? .nan
    y = (try? container?.decode(Double.self, forKey: .y)) ?? .nan
    w = try? container?.decodeIfPresent(Double.self, forKey: .w)
    h = try? container?.decodeIfPresent(Double.self, forKey: .h)
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(appId, forKey: .appId)
    try container.encode(widgetId, forKey: .widgetId)
    try container.encode(family, forKey: .family)
    try container.encode(display, forKey: .display)
    try container.encode(x, forKey: .x)
    try container.encode(y, forKey: .y)
    try container.encodeIfPresent(w, forKey: .w)
    try container.encodeIfPresent(h, forKey: .h)
  }

  private enum CodingKeys: String, CodingKey {
    case appId
    case widgetId
    case family
    case display
    case x
    case y
    case w
    case h
  }

  /// The checked record, nil when any member breaks the rules.
  var record: DesktopPinRecord? {
    guard UserAppOrigin.isValidAppId(appId), x.isFinite, y.isFinite,
      display.map({ !$0.isEmpty && $0.utf8.count <= 64 }) ?? true
    else { return nil }
    let face: DesktopPinFace
    switch (widgetId, family.flatMap(WidgetFamily.init(rawValue:))) {
    case (nil, nil) where family == nil: face = .tile(family: .systemSmall)
    case (nil, let tile?) where DesktopPinFace.tileFamilies.contains(tile):
      face = .tile(family: tile)
    case (let id?, let family?) where WidgetSelection.isValidWidgetId(id):
      face = .widget(id: id, family: family)
    default: return nil
    }
    let size: WindowSize?
    switch (w, h) {
    case (nil, nil): size = nil
    case (let w?, let h?) where Self.sides.contains(w) && Self.sides.contains(h):
      size = WindowSize(width: w, height: h)
    default: return nil
    }
    return DesktopPinRecord(
      appId: appId, face: face, display: display, offset: .init(x: x, y: y), size: size)
  }

  /// The sides a stored size may have. The pin keeps its size to what its layouts handle when it
  /// shows, so this only refuses what no build writes.
  private static let sides = 100.0...4096.0

  /// A tile's stored family: none for the small one, as every tile was stored before tiles came
  /// in two sizes, so a build that knew only that one still reads it.
  private static func tileFamily(_ family: WidgetFamily) -> String? {
    family == .systemSmall ? nil : family.rawValue
  }
}
