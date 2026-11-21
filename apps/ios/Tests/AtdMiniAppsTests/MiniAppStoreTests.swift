import AtdModel
import Foundation
import Testing

@testable import AtdMiniApps

@Suite struct MiniAppStoreTests {
  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "MiniAppStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  private var store: MiniAppStore {
    MiniAppStore(directory: directory, notificationName: nil)
  }

  private func reading() throws -> MiniAppDraft {
    try MiniAppDraft(answer: MiniAppAnswer(Answers.reading))
  }

  @Test func theLibraryStartsWithTheBuiltinsOnce() throws {
    let library = store.library()
    #expect(library.apps.map(\.id) == MiniAppBuiltins.ids)
    #expect(library.apps.allSatisfy { $0.builtin })
    let water = try #require(library.app(MiniAppBuiltins.waterID))
    let manifest = try #require(store.manifest(water))
    #expect(store.data(water.id, schema: manifest.schema).number("goal") == 8)
    let camp = try #require(library.app(MiniAppBuiltins.campID))
    let items = store.data(camp.id, schema: try #require(store.manifest(camp)).schema)
      .records("items")
    #expect(items.count == 12 && items.allSatisfy { $0["packed"] == false })
    // Reading again seeds nothing more.
    let stored = store.library()
    #expect(stored.apps.map(\.id) == library.apps.map(\.id) && store.library() == stored)
  }

  @Test func aBuiltinThatWentMissingComesBackWithoutLosingData() throws {
    let water = try #require(store.library().app(MiniAppBuiltins.waterID))
    let schema = try #require(store.manifest(water)).schema
    try store.apply(
      [.put(field: "cups", value: 3, day: nil)], to: water.id, schema: schema,
      context: MiniAppChangeContext(now: .now))
    try SharedStore(directory: directory, notificationName: nil).update(MiniAppLibrary.self) {
      $0.apps.removeAll { $0.id == MiniAppBuiltins.waterID }
    }
    let library = store.library()
    #expect(library.app(MiniAppBuiltins.waterID) != nil)
    #expect(library.apps.map(\.id) == MiniAppBuiltins.ids)
    #expect(store.data(water.id, schema: schema).series("cups").values.first == 3)
  }

  @Test func anAppIsSavedChangedAndDeleted() throws {
    let draft = try reading()
    try store.create(draft.app, package: draft.package, data: draft.data)
    let library = store.library()
    #expect(library.apps.last?.id == draft.app.id && library.recentID == draft.app.id)
    let app = try #require(library.app(draft.app.id))
    #expect(app.version == 1 && store.package(app) == draft.package)

    let schema = draft.package.manifest.schema
    let (data, undo) = try store.apply(
      [.put(field: "pages", value: 30, day: "2026-11-20")], to: app.id, schema: schema,
      context: Fixture.context())
    #expect(data.series("pages") == ["2026-11-20": 30])
    #expect(store.data(app.id, schema: schema) == data)
    try store.apply(undo, to: app.id, schema: schema, context: Fixture.context())
    #expect(store.data(app.id, schema: schema).series("pages").isEmpty)

    try store.delete(app.id)
    #expect(store.library().app(app.id) == nil && store.library().recentID == nil)
    #expect(!FileManager.default.fileExists(atPath: store.appFolder(app.id).path()))
  }

  @Test func aBuiltinNobodyChangedGetsTheShippedPage() throws {
    let water = try #require(store.library().app(MiniAppBuiltins.waterID))
    let shipped = try #require(store.package(water))
    try store.writeVersion(
      MiniAppPackage(manifest: shipped.manifest, page: "<p>old</p>"), app: water.id, version: 1)
    store.updateBuiltinPages()
    #expect(store.package(water) == shipped)

    let next = MiniAppPackage(manifest: shipped.manifest, page: "<p>mine</p>")
    _ = try store.refine(water.id, to: next, operations: [], ideas: nil)
    store.updateBuiltinPages()
    #expect(try #require(store.library().app(water.id)).version == 2)
    #expect(store.package(try #require(store.library().app(water.id))) == next)
  }

  @Test func builtinsCannotBeDeleted() throws {
    try store.delete(MiniAppBuiltins.ledgerID)
    #expect(store.library().app(MiniAppBuiltins.ledgerID) != nil)
  }

  @Test func aRefinementCanBeUndone() throws {
    let water = try #require(store.library().app(MiniAppBuiltins.waterID))
    let first = try #require(store.package(water))
    var manifest = first.manifest
    manifest.schema.fields.append(MiniAppField("note", .text))
    let next = MiniAppPackage(manifest: manifest, page: "<p>cups</p>")
    let undo = try store.refine(
      water.id, to: next, operations: [.set(field: "goal", value: 10)], ideas: ["More water"])
    let refined = try #require(store.library().app(water.id))
    #expect(refined.version == 2 && refined.ideas == ["More water"])
    #expect(store.package(refined) == next)
    #expect(store.data(water.id, schema: manifest.schema).number("goal") == 10)

    try store.undo(undo)
    let back = try #require(store.library().app(water.id))
    #expect(back.version == 1 && back.ideas == water.ideas && store.package(back) == first)
    #expect(store.data(water.id, schema: first.manifest.schema).number("goal") == 8)
  }

  @Test func aRefinementMustKeepTheData() throws {
    let water = try #require(store.library().app(MiniAppBuiltins.waterID))
    var manifest = try #require(store.manifest(water))
    manifest.schema.fields.removeAll { $0.name == "goal" }
    manifest.widget = .stat(
      .init(value: .series("cups", .today), unit: nil, kicker: "Cups", bars: nil))
    let next = MiniAppPackage(manifest: manifest, page: "<p>cups</p>")
    #expect(throws: MiniAppInvalid.self) {
      _ = try store.refine(water.id, to: next, operations: [], ideas: nil)
    }
    #expect(store.library().app(water.id)?.version == 1)
  }

  @Test func onlyTheLastFiveVersionsStay() throws {
    let water = try #require(store.library().app(MiniAppBuiltins.waterID))
    let manifest = try #require(store.manifest(water))
    for version in 2...8 {
      _ = try store.refine(
        water.id, to: MiniAppPackage(manifest: manifest, page: "<p>\(version)</p>"),
        operations: [], ideas: nil)
    }
    let folders = try FileManager.default.contentsOfDirectory(
      atPath: store.appFolder(water.id).path())
    #expect(Set(folders.filter { $0.hasPrefix("v") }) == ["v4", "v5", "v6", "v7", "v8"])
  }

  @Test func theLastOpenedAppIsWhatANewWidgetShows() throws {
    store.noteOpened(MiniAppBuiltins.campID)
    #expect(store.library().recent?.id == MiniAppBuiltins.campID)
  }

  @Test func anAppWhoseFilesAreGoneReadsAsMissing() throws {
    let draft = try reading()
    try store.create(draft.app, package: draft.package, data: draft.data)
    try FileManager.default.removeItem(at: store.versionFolder(draft.app.id, 1))
    let app = try #require(store.library().app(draft.app.id))
    #expect(store.manifest(app) == nil && store.package(app) == nil)
    let glance = MiniAppGlance.make(app: app, manifest: nil, data: nil)
    guard case .missing = glance.body else {
      Issue.record("the glance is not missing")
      return
    }
  }
}

@Suite struct MiniAppBuiltinsTests {
  @Test func everyBuiltinIsAValidPackage() throws {
    for (app, package) in MiniAppBuiltins.all() {
      try package.validate()
      #expect(MiniApps.isValidID(app.id) && app.builtin && !app.name.isEmpty)
      #expect(app.ideas.count == 2)
      #expect(package.page.utf8.count < 16 * 1_024, "\(app.id)'s page is larger than 16 KB")
      _ = try MiniAppData.initial(
        schema: package.manifest.schema, initial: package.manifest.initial)
    }
  }

  @Test func onlyTheLedgerReadsTheLedger() {
    let ledgers = MiniAppBuiltins.all().filter { $0.package.manifest.schema.ledger }
    #expect(ledgers.map(\.app.id) == [MiniAppBuiltins.ledgerID])
  }

  @Test func aManifestSurvivesItsFile() throws {
    for (_, package) in MiniAppBuiltins.all() {
      let decoded = try JSONDecoder().decode(MiniAppManifest.self, from: package.manifestData())
      #expect(decoded == package.manifest)
    }
  }

  @Test func idsAreShortAndPlain() {
    #expect(MiniApps.isValidID("reading-7f3a"))
    #expect(!MiniApps.isValidID("Reading") && !MiniApps.isValidID("../ledger"))
    #expect(!MiniApps.isValidID("") && !MiniApps.isValidID(String(repeating: "a", count: 41)))
    for _ in 0..<20 { #expect(MiniApps.isValidID(MiniApps.newID())) }
  }
}
