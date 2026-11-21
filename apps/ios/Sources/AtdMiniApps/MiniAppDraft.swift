import AtdInk
import AtdModel
import Foundation

/// Why an answer did not make an app.
public enum MiniAppDraftFailure: Error, Sendable, Equatable {
  /// The data or widget section's JSON does not fit; asking once more for that section alone
  /// (`MiniAppPrompt.repair`) can fix it.
  case section(MiniAppAnswer.Section, String)
  /// Anything else: sections missing, an empty page, nothing changed.
  case unreadable(String)
}

/// A new app read from a finished build answer: its entry, its first version and the data it
/// starts with, which the preview's page may already have changed.
public struct MiniAppDraft: Sendable, Equatable {
  public var app: MiniApp
  public var package: MiniAppPackage
  public var data: MiniAppData
  /// The four build steps' one-line details: what the model understood, the data, the page and
  /// the widget.
  public var details: [String]

  /// A symbol outside `StickerSymbols` becomes a generic one, so the app's sticker has its glyph.
  public init(answer: MiniAppAnswer, now: Date = .now) throws(MiniAppDraftFailure) {
    let about = answer.about
    guard answer.has(.data), answer.has(.page), answer.has(.widget) else {
      throw .unreadable("the answer lacks a section")
    }
    let schema = try Self.schema(answer, ledger: false)
    let data: MiniAppData
    do {
      data = try MiniAppData.initial(
        schema: schema, initial: answer.json(.data)?["initial"]?.object)
    } catch {
      throw .section(.data, error.reason)
    }
    let widget = try Self.widget(answer, schema: schema)
    let package = MiniAppPackage(
      manifest: MiniAppManifest(schema: schema, widget: widget), page: try Self.page(answer))
    do {
      try package.validate()
    } catch {
      throw .unreadable(error.reason)
    }
    let id = MiniApps.newID()
    let name = String((about["name"] ?? "").prefix(MiniAppLimits.nameLength))
    let symbol =
      about["symbol"].flatMap { StickerSymbols.contains($0) ? $0 : nil } ?? "square.grid.2x2"
    let tints = CommandTint.allCases.filter { $0 != .gray }
    let tint =
      about["tint"].flatMap { CommandTint(rawValue: $0.lowercased()) }
      ?? tints[inkSeed(id) % tints.count]
    app = MiniApp(
      id: id, name: name.isEmpty ? MiniAppGlance.localized("glance.app") : name, symbol: symbol,
      tint: tint, ideas: answer.ideas ?? [], createdAt: now)
    self.package = package
    self.data = data
    details = ["understand", "data", "page", "widget"].map { about[$0] ?? "" }
  }

  /// The fields of `[[DATA]]`.
  static func schema(_ answer: MiniAppAnswer, ledger: Bool) throws(MiniAppDraftFailure)
    -> MiniAppSchema
  {
    guard let json = answer.json(.data) else { throw .section(.data, "it is not JSON") }
    guard let fields = json["fields"],
      let data = try? JSONEncoder().encode(fields),
      let decoded = try? JSONDecoder().decode([MiniAppField].self, from: data)
    else {
      throw .section(.data, "fields must be a list of {name, kind, ...} objects")
    }
    let schema = MiniAppSchema(fields: decoded, ledger: ledger)
    do {
      try schema.validate()
    } catch {
      throw .section(.data, error.reason)
    }
    return schema
  }

  static func widget(_ answer: MiniAppAnswer, schema: MiniAppSchema) throws(MiniAppDraftFailure)
    -> MiniAppWidgetSpec
  {
    guard let json = answer.json(.widget) else { throw .section(.widget, "it is not JSON") }
    do {
      return try MiniAppWidgetSpec(json: json, schema: schema)
    } catch {
      throw .section(.widget, error.reason)
    }
  }

  /// The page's body; a whole document is tolerated and its body taken out.
  static func page(_ answer: MiniAppAnswer) throws(MiniAppDraftFailure) -> String {
    var page = answer.content(.page) ?? ""
    if let body = page.range(of: "<body", options: .caseInsensitive),
      let open = page[body.upperBound...].firstIndex(of: ">")
    {
      let end = page.range(of: "</body>", options: [.caseInsensitive, .backwards])
      page = String(page[page.index(after: open)..<(end?.lowerBound ?? page.endIndex)])
    }
    page = page.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !page.isEmpty else { throw .unreadable("the page is empty") }
    return page
  }

}

/// 改一改 read from a finished refine answer: the next version and what it changes in the data.
public struct MiniAppRefinement: Sendable, Equatable {
  public var package: MiniAppPackage
  public var operations: [MiniAppOperation]
  /// What changed, for the 撤销 line.
  public var summary: String
  public var ideas: [String]?

  public init(answer: MiniAppAnswer, current: MiniAppPackage) throws(MiniAppDraftFailure) {
    guard answer.has(.data) || answer.has(.page) || answer.has(.widget) else {
      throw .unreadable("the answer changes nothing")
    }
    var manifest = current.manifest
    var operations: [MiniAppOperation] = []
    if answer.has(.data) {
      if answer.json(.data)?["fields"] != nil {
        manifest.schema = try MiniAppDraft.schema(answer, ledger: current.manifest.schema.ledger)
        do {
          try manifest.schema.check(replacing: current.manifest.schema)
        } catch {
          throw .section(.data, error.reason)
        }
      }
      for op in answer.json(.data)?["ops"]?.array ?? [] {
        do throws(MiniAppInvalid) {
          let operation = try MiniAppOperation(json: op)
          switch operation {
          case .add, .put, .restore:
            throw MiniAppInvalid("ops cannot change daily history or restore records")
          default:
            operations.append(operation)
          }
        } catch {
          throw .section(.data, error.reason)
        }
      }
    }
    if answer.has(.widget) {
      manifest.widget = try MiniAppDraft.widget(answer, schema: manifest.schema)
    } else {
      do {
        try manifest.widget.validate(against: manifest.schema)
      } catch {
        throw .section(.data, error.reason)
      }
    }
    let page = answer.has(.page) ? try MiniAppDraft.page(answer) : current.page
    package = MiniAppPackage(manifest: manifest, page: page)
    do {
      try package.validate()
    } catch {
      throw .unreadable(error.reason)
    }
    self.operations = operations
    summary = String((answer.about["summary"] ?? "").prefix(60))
    ideas = answer.ideas
  }
}
