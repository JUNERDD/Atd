import AppIntents
import AtdIntents
import AtdModel
import CoreSpotlight

/// Keeps what Siri, Shortcuts and Spotlight offer in step with Atd: the App Shortcuts' parameter
/// values and the commands in Spotlight. Call `refresh()` after anything they offer changes, such
/// as the command library.
///
/// The `AppShortcutsProvider` must be declared in the App target, which this module cannot name,
/// so the app installs its update at launch (`AtdAppLaunch.prepare(shortcuts:)`). Until then, as
/// in tests and previews, only Spotlight is refreshed.
public enum AtdShortcuts {
  private static var update: (@MainActor () -> Void)?
  /// The latest Spotlight pass; each waits for the one before, so an older pass never lands last.
  private static var indexing: Task<Void, Never>?

  static func install(_ update: @escaping @MainActor () -> Void) {
    self.update = update
  }

  public static func refresh() {
    update?()
    reindex()
  }

  /// Replaces Atd's commands in Spotlight with those placed in Siri, as the library stores them.
  /// Spotlight is a convenience: a pass that fails leaves the previous index.
  private static func reindex() {
    let previous = indexing
    indexing = Task {
      await previous?.value
      guard let library = try? EntryContext.live().library else { return }
      let entities = CommandCatalog.commands(on: .siri, in: library).map(CommandEntity.init)
      let index = CSSearchableIndex.default()
      try? await index.deleteAppEntities(ofType: CommandEntity.self)
      try? await index.indexAppEntities(entities)
    }
  }
}
