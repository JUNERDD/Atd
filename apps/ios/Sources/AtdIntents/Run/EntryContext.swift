import AtdAI
import AtdActions
import AtdModel
import Foundation

/// What an entry point runs with: the App Group's files, the person's model connections and
/// their calendar and reminders.
///
/// The system starts intents and widgets outside the app's views, in the app's process or the
/// widget extension's, so each run reads the files as they are stored then, as the keyboard does.
public struct EntryContext: Sendable {
  public let store: SharedStore
  public let generator: any TextGenerating
  public let reader: TodayReader

  public init(
    store: SharedStore, generator: any TextGenerating, reader: TodayReader = TodayReader()
  ) {
    self.store = store
    self.generator = generator
    self.reader = reader
  }

  /// The App Group's files, with requests sent on the connections stored there.
  /// - Throws: `IntentFailure.unavailable` when the bundle names no App Group it can open, which
  ///   only a misbuilt bundle does.
  public static func live() throws(IntentFailure) -> EntryContext {
    guard let group = AppGroup.current(), let store = SharedStore.appGroup(group) else {
      throw .unavailable
    }
    let generator = ModelRunner(settings: { store.load(AppSettings.self).document })
    return EntryContext(store: store, generator: generator)
  }

  /// The library as stored now.
  public var library: CommandLibrary {
    store.load(CommandLibrary.self).document
  }

  /// The command with `id` as stored now.
  /// - Throws: `IntentFailure.commandMissing` when it was removed after a shortcut or a control
  ///   was set up with it.
  public func command(_ id: String) throws(IntentFailure) -> Command {
    guard let command = library.command(id) else { throw .commandMissing }
    return command
  }
}
