import Foundation

/// One version of a mini app's code and shape (`mini-apps/<id>/v<N>/manifest.json`): its data's
/// fields, the values a new copy starts with, and its widget. The page is beside it
/// (`page.html`). Name, symbol and tint belong to the app (`MiniApp`), not to a version.
public struct MiniAppManifest: Sendable, Equatable {
  public static let format = 1

  public var schema: MiniAppSchema
  /// What a new copy starts with (the built-in 露营清单's gear list); applied once, at creation.
  public var initial: [String: MiniAppJSON]?
  public var widget: MiniAppWidgetSpec

  public init(
    schema: MiniAppSchema, initial: [String: MiniAppJSON]? = nil, widget: MiniAppWidgetSpec
  ) {
    self.schema = schema
    self.initial = initial
    self.widget = widget
  }
}

extension MiniAppManifest: Codable {
  private enum CodingKeys: String, CodingKey {
    case format, fields, ledger, initial, widget
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let format = try container.decode(Int.self, forKey: .format)
    guard format == Self.format else {
      throw DecodingError.dataCorruptedError(
        forKey: .format, in: container, debugDescription: "unknown format \(format)")
    }
    schema = MiniAppSchema(
      fields: try container.decode([MiniAppField].self, forKey: .fields),
      ledger: try container.decodeIfPresent(Bool.self, forKey: .ledger) ?? false)
    initial = try container.decodeIfPresent([String: MiniAppJSON].self, forKey: .initial)
    let widget = try container.decode(MiniAppJSON.self, forKey: .widget)
    do {
      self.widget = try MiniAppWidgetSpec(json: widget, schema: schema)
    } catch {
      throw DecodingError.dataCorruptedError(
        forKey: .widget, in: container, debugDescription: error.reason)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(Self.format, forKey: .format)
    try container.encode(schema.fields, forKey: .fields)
    if schema.ledger { try container.encode(true, forKey: .ledger) }
    try container.encodeIfPresent(initial, forKey: .initial)
    try container.encode(widget.json, forKey: .widget)
  }
}

/// A version as it is generated, checked and stored: the manifest and the page body.
public struct MiniAppPackage: Sendable, Equatable {
  public var manifest: MiniAppManifest
  /// The page's body: its markup, `<style>` and `<script>`, without `<html>` or `<head>`.
  public var page: String

  public init(manifest: MiniAppManifest, page: String) {
    self.manifest = manifest
    self.page = page
  }

  /// Checks the limits a package must keep and that its parts fit together.
  public func validate() throws(MiniAppInvalid) {
    try manifest.schema.validate()
    try manifest.widget.validate(against: manifest.schema)
    _ = try MiniAppData.initial(schema: manifest.schema, initial: manifest.initial)
    guard (try? manifestData().count).map({ $0 <= MiniAppLimits.manifestBytes }) == true else {
      throw MiniAppInvalid("the data and widget sections are larger than 16 KB")
    }
    guard !page.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw MiniAppInvalid("the page is empty")
    }
    guard page.utf8.count <= MiniAppLimits.pageBytes else {
      throw MiniAppInvalid("the page is larger than 128 KB")
    }
  }

  func manifestData() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(manifest)
  }
}

extension MiniAppWidgetSpec {
  /// The spec as the manifest stores it, the same shape the model writes.
  public var json: MiniAppJSON {
    var object: [String: MiniAppJSON] = [:]
    func put(_ key: String, _ value: String?) {
      if let value { object[key] = .string(value) }
    }
    func put(_ key: String, _ amount: MiniAppAmount?) {
      switch amount {
      case .field(let name)?: object[key] = .string(name)
      case .literal(let value)?: object[key] = .number(value)
      case nil: break
      }
    }
    switch self {
    case .counter(let counter):
      object["template"] = "counter"
      put("series", counter.series)
      put("goal", counter.goal)
      put("unit", counter.unit)
      object["step"] = .number(counter.step)
      put("button", counter.button)
    case .streak(let streak):
      object["template"] = "streak"
      put("series", streak.series)
      put("goal", streak.goal)
      put("unit", streak.unit)
      put("kicker", streak.kicker)
    case .checklist(let checklist):
      object["template"] = "checklist"
      put("list", checklist.list)
      put("done", checklist.done)
      put("label", checklist.label)
      put("kicker", checklist.kicker)
      put("next", checklist.next)
      put("finished", checklist.finished)
    case .ledger:
      object["template"] = "ledger"
    case .stat(let stat):
      object["template"] = "stat"
      switch stat.value {
      case .field(let name): object["value"] = .string(name)
      case .series(let name, let part):
        object["value"] = ["series": .string(name), "of": .string(part.rawValue)]
      case .daysUntil(let name): object["value"] = ["daysUntil": .string(name)]
      }
      put("unit", stat.unit)
      put("kicker", stat.kicker)
      put("bars", stat.bars)
    case .list(let rows):
      object["template"] = "list"
      put("list", rows.list)
      put("title", rows.title)
      put("trailing", rows.trailing)
      put("kicker", rows.kicker)
    }
    return .object(object)
  }
}
