import AtdAI
import AtdModel

extension AppStore {
  /// Saves a drafted command and says whether the library now holds it. When the write fails,
  /// the alert at the root says so and the draft stays on show.
  func add(_ command: Command) -> Bool {
    save(command)
    return library.command(command.id) != nil
  }

  /// Marks the key of the connection a run with `choice` went to as refused, when the provider
  /// refused it, so that connection's row asks for a new key.
  func noteFailure(_ failure: ModelFailure, for choice: ModelChoice) {
    guard failure == .invalidKey, let id = settings.resolve(choice)?.connection.id else { return }
    refusedKeys.insert(id)
  }
}
