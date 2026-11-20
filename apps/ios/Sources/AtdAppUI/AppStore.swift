import AtdAI
import AtdModel
import Foundation
import Observation
import WidgetKit

/// What the app shows and edits: the command library, the phrases, the model connections and what
/// the keyboard last reported, kept in the App Group's files so the keyboard reads the same.
///
/// Every edit is written at once, and the keyboard uses it the next time it appears. When the
/// keyboard writes a file (an option chosen in its panel), the store reloads.
@Observable
final class AppStore {
  private(set) var library: CommandLibrary
  private(set) var phrases: PhraseBook
  private(set) var settings: AppSettings
  private(set) var keyboard: KeyboardStatus
  /// Connections whose key the provider refused, so their rows ask for a new one.
  var refusedKeys: Set<String> = []
  /// A write that failed, for the alert at the root.
  var failure: String?

  @ObservationIgnored let store: SharedStore
  @ObservationIgnored let secrets: any SecretStoring
  @ObservationIgnored private var observer: DarwinObserver?
  @ObservationIgnored private var watching: Task<Void, Never>?

  init(store: SharedStore, secrets: any SecretStoring = KeychainSecretStore()) {
    self.store = store
    self.secrets = secrets
    // Both processes start from the same built-in commands and phrases, in the language the app
    // first ran in.
    try? store.createIfMissing(CommandLibrary.self)
    try? store.createIfMissing(PhraseBook.self)
    library = store.load(CommandLibrary.self).document
    phrases = store.load(PhraseBook.self).document
    settings = store.load(AppSettings.self).document
    keyboard = store.load(KeyboardStatus.self).document
  }

  /// The App Group's store. Without the group (SwiftUI previews), the app's own container: it
  /// works the same, the keyboard just cannot see it.
  static func live() -> AppStore {
    if let group = AppGroup.current(), let shared = SharedStore.appGroup(group) {
      let store = AppStore(store: shared)
      store.watch(group)
      return store
    }
    let directory = URL.applicationSupportDirectory.appending(
      path: "Atd", directoryHint: .isDirectory)
    return AppStore(store: SharedStore(directory: directory, notificationName: nil))
  }

  /// Runs requests on the default connection, read from the settings file at every request.
  var runner: ModelRunner {
    let store = store
    return ModelRunner(settings: { store.load(AppSettings.self).document }, secrets: secrets)
  }

  var hasModel: Bool { settings.defaultConnection != nil }

  func reload() {
    library = store.load(CommandLibrary.self).document
    phrases = store.load(PhraseBook.self).document
    settings = store.load(AppSettings.self).document
    keyboard = store.load(KeyboardStatus.self).document
  }

  // MARK: Commands

  /// Saves an edited or new command as a new revision.
  func save(_ command: Command) {
    var command = command
    if let stored = library.command(command.id) {
      guard stored != command else { return }
      command.revision = stored.revision + 1
    }
    write(CommandLibrary.self) { $0.upsert(command) }.map(libraryChanged)
  }

  func removeCommand(_ id: String) {
    write(CommandLibrary.self) { $0.remove(id) }.map(libraryChanged)
  }

  /// Commands also show outside the app, in App Shortcuts and in widgets, which read the library
  /// on their own; both are told when it changes.
  private func libraryChanged(_ library: CommandLibrary) {
    self.library = library
    AtdShortcuts.refresh()
    WidgetCenter.shared.reloadAllTimelines()
  }

  // MARK: Phrases

  func setPhrases(_ list: [Phrase]) {
    write(PhraseBook.self) { $0.phrases = list }.map { phrases = $0 }
  }

  // MARK: Connections

  /// Saves a connection and, when given, its key.
  func save(_ connection: ProviderConnection, key: String?) {
    if let key {
      do {
        try secrets.setKey(key, for: connection.id)
      } catch {
        failure = AppText.string("failure.keychain")
        return
      }
      refusedKeys.remove(connection.id)
    }
    write(AppSettings.self) { $0.upsert(connection) }.map { settings = $0 }
  }

  func removeConnection(_ id: String) {
    try? secrets.removeKey(for: id)
    refusedKeys.remove(id)
    write(AppSettings.self) { $0.remove(id) }.map { settings = $0 }
  }

  func makeDefault(_ id: String) {
    write(AppSettings.self) { $0.defaultConnectionID = id }.map { settings = $0 }
  }

  func key(for connectionID: String) -> String? {
    try? secrets.key(for: connectionID)
  }

  /// Marks the default connection's key as refused, when a request failed because of it.
  func noteFailure(_ failure: ModelFailure) {
    guard failure == .invalidKey, let id = settings.defaultConnection?.id else { return }
    refusedKeys.insert(id)
  }

  // MARK: Files

  private func write<Document: SharedDocument>(
    _ type: Document.Type, _ change: (inout Document) -> Void
  ) -> Document? {
    do {
      return try store.update(type, change).document
    } catch {
      failure = AppText.string("failure.save")
      return nil
    }
  }

  /// Reloads whenever the keyboard writes a shared file.
  private func watch(_ group: AppGroup) {
    let observer = DarwinObserver(name: group.changeNotificationName)
    self.observer = observer
    watching = Task { [weak self] in
      for await _ in observer.changes {
        self?.reload()
      }
    }
  }
}
