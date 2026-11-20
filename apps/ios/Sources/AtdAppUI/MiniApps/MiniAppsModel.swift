import AtdActions
import AtdMiniApps
import AtdModel
import Foundation
import Observation
import WidgetKit

/// The 小应用 tab's state: the library, each app's glance for its card, and every write the app
/// makes to a mini app or, for 记账本, to the ledger.
///
/// It reloads whenever another process changes a mini app (a widget button) or the shared files
/// (an expense logged in the camera or the share sheet), and open pages push what changed.
@Observable
final class MiniAppsModel {
  private(set) var library = MiniAppLibrary()
  private(set) var glances: [String: MiniAppGlance] = [:]
  /// Counts reloads, so an open page pushes its data again when it changed underneath it.
  private(set) var changes = 0

  @ObservationIgnored let store: MiniAppStore
  @ObservationIgnored let ledgerBook: LedgerBook
  @ObservationIgnored private var observers: [DarwinObserver] = []
  @ObservationIgnored private var watching: [Task<Void, Never>] = []
  @ObservationIgnored private var widgetReload: Task<Void, Never>?

  init(store: MiniAppStore, ledgerStore: SharedStore) {
    self.store = store
    ledgerBook = LedgerBook(store: ledgerStore)
    reload()
  }

  /// The app's one model, which the tab, the sheets and the debug hooks share.
  static let shared = live()

  /// The App Group's mini apps; without the group (previews), the app's own container, like
  /// `AppStore.live()`.
  static func live() -> MiniAppsModel {
    if let group = AppGroup.current(), let store = MiniAppStore.appGroup(group),
      let shared = SharedStore.appGroup(group)
    {
      store.updateBuiltinPages()
      let model = MiniAppsModel(store: store, ledgerStore: shared)
      model.watch([MiniApps.changeNotificationName(for: group), group.changeNotificationName])
      return model
    }
    let directory = URL.applicationSupportDirectory.appending(
      path: "Atd", directoryHint: .isDirectory)
    return MiniAppsModel(
      store: MiniAppStore(directory: directory, notificationName: nil),
      ledgerStore: SharedStore(directory: directory, notificationName: nil))
  }

  func reload() {
    let library = store.library()
    var ledger: Ledger?
    var glances: [String: MiniAppGlance] = [:]
    for app in library.apps {
      let manifest = store.manifest(app)
      if manifest?.schema.ledger == true, ledger == nil { ledger = store.ledger() }
      glances[app.id] = MiniAppGlance.make(
        app: app, manifest: manifest,
        data: manifest.map { store.data(app.id, schema: $0.schema) },
        ledger: manifest?.schema.ledger == true ? ledger : nil)
    }
    self.library = library
    self.glances = glances
    changes += 1
  }

  func app(_ id: String) -> MiniApp? {
    library.app(id)
  }

  // MARK: Pages

  /// Performs what a stored app's page asked for; returns what the change made, when the page
  /// gets it back (an inserted record, a logged expense).
  /// - Parameter book: the book an expense 记账本 logs goes in: 记一笔's remembered 记到.
  func perform(
    _ request: MiniAppBridgeRequest, app: MiniApp, manifest: MiniAppManifest, book: String
  ) throws -> MiniAppJSON? {
    switch request {
    case .change(let operation):
      let (data, undo) = try store.apply(
        [operation], to: app.id, schema: manifest.schema, context: MiniAppChangeContext(now: .now))
      dataChanged()
      if case .insert(let list, _) = operation, case .remove(_, let id)? = undo.first {
        return data.records(list).first { $0.recordID == id }.map(MiniAppJSON.object)
      }
      return nil
    case .logExpense(let input):
      let currency = MiniAppLedgerSummary(ledger: store.ledger()).currency
      let expense: Expense
      do {
        expense = try ledgerBook.add(
          input.draft(currency: currency, book: book, date: .now), source: .manual)
      } catch ActionError.invalidExpense {
        throw MiniAppInvalid("the expense needs an amount above 0")
      }
      reload()
      return MiniAppLedgerSummary.json(expense)
    case .removeExpense(let id):
      try ledgerBook.remove(id: id)
      reload()
      return nil
    case .symbols, .error:
      return nil
    }
  }

  /// A page changed data: the cards now, the widgets once the changes settle.
  private func dataChanged() {
    reload()
    widgetReload?.cancel()
    widgetReload = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      self?.reloadWidgets()
    }
  }

  /// Reloads the widgets now if a page's change is still waiting (the sheet closed).
  func flushWidgets() {
    guard widgetReload != nil else { return }
    reloadWidgets()
  }

  private func reloadWidgets() {
    widgetReload?.cancel()
    widgetReload = nil
    WidgetCenter.shared.reloadTimelines(ofKind: MiniApps.widgetKind)
  }

  // MARK: Library

  func create(_ draft: MiniAppDraft, data: MiniAppData) throws {
    try store.create(draft.app, package: draft.package, data: data)
    reload()
    reloadWidgets()
  }

  func refine(_ app: MiniApp, with refinement: MiniAppRefinement) throws -> MiniAppUndo {
    let undo = try store.refine(
      app.id, to: refinement.package, operations: refinement.operations, ideas: refinement.ideas)
    reload()
    reloadWidgets()
    return undo
  }

  func undo(_ undo: MiniAppUndo) throws {
    try store.undo(undo)
    reload()
    reloadWidgets()
  }

  func delete(_ app: MiniApp) throws {
    try store.delete(app.id)
    reload()
    reloadWidgets()
  }

  /// A newly added widget shows the app opened last.
  func opened(_ app: MiniApp) {
    store.noteOpened(app.id)
  }

  private func watch(_ names: [String]) {
    for name in names {
      let observer = DarwinObserver(name: name)
      observers.append(observer)
      watching.append(
        Task { [weak self] in
          for await _ in observer.changes {
            self?.reload()
          }
        })
    }
  }
}

/// The 小应用 tab's copy, from the `MiniApps` table of this module's String Catalog.
enum MiniAppText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "MiniApps", bundle: .module)
  }

  /// The language the app shows itself in, which mini apps' pages and generated words follow.
  static var language: String {
    Bundle.main.preferredLocalizations.first ?? "en"
  }
}
