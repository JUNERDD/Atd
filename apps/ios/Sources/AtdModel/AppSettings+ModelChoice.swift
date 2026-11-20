/// A connection and the model a run asks it for, as `AppSettings.resolve(_:)` decides them.
public struct ResolvedModel: Sendable, Equatable {
  public var connection: ProviderConnection
  public var model: String
  /// Whether the command's own choice answers. False when the default stands in: the command
  /// asks for the default, or it names a connection that was removed.
  public var isChosen: Bool

  public init(connection: ProviderConnection, model: String, isChosen: Bool) {
    self.connection = connection
    self.model = model
    self.isChosen = isChosen
  }
}

extension AppSettings {
  /// The connection and model a run with `choice` uses: the chosen connection with the chosen
  /// model while that connection exists, otherwise the default connection with its own model.
  /// Nil while there is no connection at all.
  ///
  /// The one place this is decided, for the runner that sends the request and for the app that
  /// shows the choice (默认, or the connection and model) and marks a refused key on the
  /// connection that answered.
  public func resolve(_ choice: ModelChoice) -> ResolvedModel? {
    if case .connection(let id, let model) = choice, let chosen = connection(id) {
      return ResolvedModel(connection: chosen, model: model, isChosen: true)
    }
    return defaultConnection.map { ResolvedModel(connection: $0, model: $0.model, isChosen: false) }
  }
}
