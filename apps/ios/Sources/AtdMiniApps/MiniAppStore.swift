import AtdModel
import Foundation

/// Reads and writes the mini apps in Atd's shared directory, for the app and for the widget
/// extension's buttons:
///
/// - `mini-apps.json`: the library (`MiniAppLibrary`);
/// - `mini-apps/<id>/v<N>/manifest.json` and `page.html`: each version, written once into a
///   fresh directory and never changed after;
/// - `mini-apps/<id>/data.json`: the app's values (`MiniAppDataFile`), changed in coordinated
///   read-modify-writes, so a widget button and the open page never lose each other's change.
///
/// Every write posts `notificationName`, so an open page reloads what a widget button changed.
public struct MiniAppStore: Sendable {
  public let directory: URL
  public let notificationName: String?

  public init(directory: URL, notificationName: String?) {
    self.directory = directory
    self.notificationName = notificationName
  }

  /// The App Group's store, or nil when this process cannot reach the group.
  public static func appGroup(_ group: AppGroup, fileManager: FileManager = .default)
    -> MiniAppStore?
  {
    guard let directory = group.directory(fileManager: fileManager) else { return nil }
    return MiniAppStore(
      directory: directory, notificationName: MiniApps.changeNotificationName(for: group))
  }

  // MARK: Reading

  /// The library, with the built-in apps in it: they are added, with their first version and
  /// data, the first time it is read and again whenever the file lost them.
  public func library() -> MiniAppLibrary {
    let stored = libraryStore.load(MiniAppLibrary.self).document
    guard MiniAppBuiltins.ids.contains(where: { stored.app($0) == nil }) else { return stored }
    let seeded = try? libraryStore.update(MiniAppLibrary.self) { library in
      try addBuiltins(to: &library, now: .now)
    }
    return seeded?.document ?? stored
  }

  /// Brings the built-in apps the person never changed to the pages this build ships, so a fix
  /// to a built-in page reaches them; a built-in changed with 改一改 is the person's own and stays.
  /// The app calls it once a launch.
  public func updateBuiltinPages(now: Date = .now) {
    let library = library()
    for builtin in MiniAppBuiltins.all(now: now) {
      guard let app = library.app(builtin.app.id), app.builtin, app.version == 1,
        let stored = package(app), stored.page != builtin.package.page
      else { continue }
      try? writeVersion(
        MiniAppPackage(manifest: stored.manifest, page: builtin.package.page), app: app.id,
        version: 1)
    }
  }

  /// The app's current version, or nil when its files cannot be read.
  public func package(_ app: MiniApp) -> MiniAppPackage? {
    let folder = versionFolder(app.id, app.version)
    guard let manifest = manifest(app),
      let page = try? String(contentsOf: folder.appending(path: "page.html"), encoding: .utf8)
    else { return nil }
    return MiniAppPackage(manifest: manifest, page: page)
  }

  /// The app's current data shape and widget, without the page (what the widget extension reads).
  public func manifest(_ app: MiniApp) -> MiniAppManifest? {
    let url = versionFolder(app.id, app.version).appending(path: "manifest.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(MiniAppManifest.self, from: data)
  }

  /// The app's values, read through `schema`.
  public func data(_ appID: String, schema: MiniAppSchema) -> MiniAppData {
    MiniAppData(schema: schema, stored: dataStore(appID).load(MiniAppDataFile.self).document.values)
  }

  /// The shared expense ledger, which only the built-in 记账本 shows. Its writers go through
  /// AtdActions' `LedgerBook`.
  public func ledger() -> Ledger {
    SharedStore(directory: directory, notificationName: nil).load(Ledger.self).document
  }

  // MARK: Writing

  /// Applies every change to the app's data, or none. Returns the data now stored and the
  /// changes that undo these.
  /// - Throws: `MiniAppInvalid` for a change the schema refuses or data over 512 KB, or the
  ///   store's error when the file cannot be written.
  @discardableResult
  public func apply(
    _ operations: [MiniAppOperation], to appID: String, schema: MiniAppSchema,
    context: MiniAppChangeContext
  ) throws -> (data: MiniAppData, undo: [MiniAppOperation]) {
    var result: (data: MiniAppData, undo: [MiniAppOperation])?
    try dataStore(appID).update(MiniAppDataFile.self) { file in
      var data = MiniAppData(schema: schema, stored: file.values)
      let undo = try data.apply(operations, schema: schema, context: context)
      guard MiniAppJSON.object(data.values).jsonData.count <= MiniAppLimits.dataBytes else {
        throw MiniAppInvalid("the app's data would be larger than 512 KB")
      }
      file.values = data.values
      result = (data, undo)
    }
    guard let result else { throw MiniAppInvalid("nothing was written") }
    return result
  }

  /// Saves a new app: its first version, its data and its place at the end of the library.
  public func create(_ app: MiniApp, package: MiniAppPackage, data: MiniAppData) throws {
    try package.validate()
    try writeVersion(package, app: app.id, version: 1)
    try dataStore(app.id).update(MiniAppDataFile.self) { $0.values = data.values }
    var app = app
    app.version = 1
    try libraryStore.update(MiniAppLibrary.self) { library in
      library.upsert(app)
      library.recentID = app.id
    }
  }

  /// Makes `package` the app's next version and applies `operations` to its data; the result
  /// undoes both. The new data shape must keep every existing field (`MiniAppSchema.check`).
  public func refine(
    _ appID: String, to package: MiniAppPackage, operations: [MiniAppOperation],
    ideas: [String]?, now: Date = .now
  ) throws -> MiniAppUndo {
    guard let app = library().app(appID), let current = manifest(app) else {
      throw MiniAppInvalid("the app's files cannot be read")
    }
    try package.validate()
    try package.manifest.schema.check(replacing: current.schema)
    let version = app.version + 1
    try writeVersion(package, app: appID, version: version)
    let undoData: [MiniAppOperation]
    do {
      undoData = try apply(
        operations, to: appID, schema: package.manifest.schema,
        context: MiniAppChangeContext(now: now)
      ).undo
      try libraryStore.update(MiniAppLibrary.self) { library in
        guard var stored = library.app(appID) else { return }
        stored.version = version
        if let ideas { stored.ideas = ideas }
        stored.updatedAt = now
        library.upsert(stored)
      }
    } catch {
      try? FileManager.default.removeItem(at: versionFolder(appID, version))
      throw error
    }
    prune(appID, keeping: version)
    return MiniAppUndo(appID: appID, version: app.version, data: undoData, ideas: app.ideas)
  }

  /// Goes back to the version before a refinement and undoes what it changed in the data, as
  /// far as the data still allows (a record removed since stays removed).
  public func undo(_ undo: MiniAppUndo) throws {
    guard let app = library().app(undo.appID), let manifest = manifest(app) else { return }
    let context = MiniAppChangeContext(now: .now)
    for operation in undo.data {
      _ = try? apply([operation], to: undo.appID, schema: manifest.schema, context: context)
    }
    try libraryStore.update(MiniAppLibrary.self) { library in
      guard var stored = library.app(undo.appID) else { return }
      stored.version = undo.version
      stored.ideas = undo.ideas
      library.upsert(stored)
    }
    if app.version > undo.version {
      try? FileManager.default.removeItem(at: versionFolder(undo.appID, app.version))
    }
  }

  /// Deletes a generated app with its versions and data. Built-in apps stay.
  public func delete(_ appID: String) throws {
    var removed = false
    try libraryStore.update(MiniAppLibrary.self) { library in
      guard let app = library.app(appID), !app.builtin else { return }
      library.apps.removeAll { $0.id == appID }
      if library.recentID == appID { library.recentID = nil }
      removed = true
    }
    if removed { try? FileManager.default.removeItem(at: appFolder(appID)) }
  }

  /// Remembers the app opened last, which a newly added widget shows.
  public func noteOpened(_ appID: String) {
    _ = try? libraryStore.update(MiniAppLibrary.self) { $0.recentID = appID }
  }

  // MARK: Files

  private var libraryStore: SharedStore {
    SharedStore(directory: directory, notificationName: notificationName)
  }

  private func dataStore(_ appID: String) -> SharedStore {
    SharedStore(directory: appFolder(appID), notificationName: notificationName)
  }

  func appFolder(_ appID: String) -> URL {
    directory.appending(path: "mini-apps/\(appID)", directoryHint: .isDirectory)
  }

  func versionFolder(_ appID: String, _ version: Int) -> URL {
    appFolder(appID).appending(path: "v\(version)", directoryHint: .isDirectory)
  }

  /// Writes the version into a fresh folder and moves it into place, so a reader sees all of it
  /// or none.
  func writeVersion(_ package: MiniAppPackage, app appID: String, version: Int) throws {
    let files = FileManager.default
    let folder = appFolder(appID)
    let staging = folder.appending(
      path: ".staging-\(UUID().uuidString)", directoryHint: .isDirectory)
    try files.createDirectory(at: staging, withIntermediateDirectories: true)
    do {
      try package.manifestData().write(to: staging.appending(path: "manifest.json"))
      try Data(package.page.utf8).write(to: staging.appending(path: "page.html"))
      let target = versionFolder(appID, version)
      // A folder at the next version is one an undo left behind; it is no one's current version.
      if files.fileExists(atPath: target.path(percentEncoded: false)) {
        try files.removeItem(at: target)
      }
      try files.moveItem(at: staging, to: target)
    } catch {
      try? files.removeItem(at: staging)
      throw error
    }
  }

  /// Keeps the current version and the four before it.
  private func prune(_ appID: String, keeping current: Int) {
    let files = FileManager.default
    guard
      let names = try? files.contentsOfDirectory(
        atPath: appFolder(appID).path(percentEncoded: false))
    else { return }
    for name in names {
      let version = name.hasPrefix("v") ? Int(name.dropFirst()) : nil
      let stale = version.map { $0 <= current - MiniAppLimits.versions || $0 > current }
      if stale ?? name.hasPrefix(".staging-") {
        try? files.removeItem(at: appFolder(appID).appending(path: name))
      }
    }
  }

  private func addBuiltins(to library: inout MiniAppLibrary, now: Date) throws {
    var position = 0
    for builtin in MiniAppBuiltins.all(now: now) {
      if library.app(builtin.app.id) != nil {
        position = (library.apps.firstIndex { $0.id == builtin.app.id } ?? position) + 1
        continue
      }
      try writeVersion(builtin.package, app: builtin.app.id, version: 1)
      let data = dataStore(builtin.app.id)
      if data.load(MiniAppDataFile.self).source != .stored {
        let values = try MiniAppData.initial(
          schema: builtin.package.manifest.schema, initial: builtin.package.manifest.initial
        ).values
        try data.update(MiniAppDataFile.self) { $0.values = values }
      }
      library.apps.insert(builtin.app, at: min(position, library.apps.count))
      position += 1
    }
  }
}

/// What 撤销 after 改一改 needs: the version to go back to, the data changes to reverse and the
/// suggestions the app had.
public struct MiniAppUndo: Sendable, Equatable {
  public var appID: String
  public var version: Int
  public var data: [MiniAppOperation]
  public var ideas: [String]
}
