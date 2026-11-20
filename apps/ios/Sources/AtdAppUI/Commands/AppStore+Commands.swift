import AtdAI
import AtdModel

extension AppStore {
  /// Marks the key of the connection a run with `choice` went to as refused, when the provider
  /// refused it, so that connection's row asks for a new key.
  func noteFailure(_ failure: ModelFailure, for choice: ModelChoice) {
    guard failure == .invalidKey, let id = settings.connection(answering: choice)?.id else {
      return
    }
    refusedKeys.insert(id)
  }
}

extension AppSettings {
  /// The connection and model `choice` names, while that connection exists. A choice naming a
  /// removed connection runs on the default again, as `ModelRunner` resolves it, so the app shows
  /// it as 默认.
  func pinned(_ choice: ModelChoice) -> (connection: ProviderConnection, model: String)? {
    guard case .connection(let id, let model) = choice, let named = connection(id) else {
      return nil
    }
    return (named, model)
  }

  /// The connection a run with `choice` goes to.
  func connection(answering choice: ModelChoice) -> ProviderConnection? {
    pinned(choice)?.connection ?? defaultConnection
  }
}
