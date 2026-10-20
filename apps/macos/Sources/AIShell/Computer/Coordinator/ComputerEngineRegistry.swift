import AICore
import Foundation

/// The engines this shell has, at most one per ``ComputerEngineID``, and whether each is
/// started. Adapters register here; with none registered every target, observe and act request
/// fails `notQualified`.
final class ComputerEngineRegistry {
  private enum StartState {
    case idle
    case starting(Task<Void, any Error>)
    case started
    case failed(String)
  }

  private var engines: [ComputerEngineID: any ComputerEngine] = [:]
  private var states: [ComputerEngineID: StartState] = [:]
  /// Told when an engine is registered, starts, fails or stops.
  var onChange: (() -> Void)?

  var isEmpty: Bool { engines.isEmpty }

  func register(_ engine: any ComputerEngine) {
    engines[engine.id] = engine
    states[engine.id] = .idle
    onChange?()
  }

  func engine(_ id: ComputerEngineID) -> (any ComputerEngine)? { engines[id] }

  /// The profiles `computer.hello` publishes, in a stable order: installed engines only.
  var profiles: [CapabilityProfileWire] {
    ComputerEngineID.allCases.compactMap { id in
      engines[id].flatMap { $0.isInstalled ? $0.profile : nil }
    }
  }

  /// The add-on installs changed: every engine takes its executables, each one whose own changed
  /// stops, and the state and profiles are published again (`computer.hello`), so the service
  /// sees an engine come or go. An engine that became installed starts on the next request.
  /// Returns the engines that stopped. A start in flight is awaited first, so the stop also ends
  /// what it started with the old executables, and the next request starts the engine afresh.
  func install(_ binaries: EngineBinaries) async -> [ComputerEngineID] {
    var changed: [any ComputerEngine] = []
    for engine in engines.values where engine.install(binaries) { changed.append(engine) }
    for engine in changed {
      if case .starting(let running) = states[engine.id] { _ = try? await running.value }
      await engine.shutdown()
      states[engine.id] = .idle
    }
    if !changed.isEmpty { onChange?() }
    return changed.map(\.id)
  }

  /// Starts `engine` once; a failed start is reported, and the next call tries again.
  func ensureStarted(_ engine: any ComputerEngine) async throws(ComputerFailure) {
    guard engine.isInstalled else { throw Self.notInstalled(engine.id) }
    if engine.generation != nil, case .started = states[engine.id] { return }
    let task: Task<Void, any Error>
    if case .starting(let running) = states[engine.id] {
      task = running
    } else {
      task = Task { try await engine.start() }
      states[engine.id] = .starting(task)
      onChange?()
    }
    do {
      try await task.value
      states[engine.id] = .started
      onChange?()
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
      states[engine.id] = .failed(message)
      onChange?()
      throw ComputerFailure(
        .engineFailed, "The \(engine.id.rawValue) engine did not start: \(message)")
    }
  }

  static func notInstalled(_ id: ComputerEngineID) -> ComputerFailure {
    ComputerFailure(
      .notQualified,
      "The \(id.rawValue) engine's add-on is not installed; it can be installed in Settings.")
  }

  /// Stops one engine (a stuck step it could not cancel); its refs go stale with its generation.
  func stop(_ engine: any ComputerEngine) async {
    await engine.shutdown()
    states[engine.id] = .idle
    onChange?()
  }

  func shutdownAll() async {
    for engine in engines.values { await engine.shutdown() }
    for id in engines.keys { states[id] = .idle }
    onChange?()
  }

  /// The engines as `computer.state` reports them, `notInstalled` while an engine's add-on is
  /// absent. Only a failure carries a detail: the profile's qualification evidence is a record
  /// for the service, not text for the person.
  var stateEvents: [ComputerStateEvent.Engine] {
    ComputerEngineID.allCases.compactMap { id in
      guard let engine = engines[id],
        let name = ComputerStateEvent.Engine.Engine(rawValue: id.rawValue)
      else { return nil }
      let (state, detail): (ComputerStateEvent.Engine.State, String) =
        switch states[id] ?? .idle {
        case _ where !engine.isInstalled: (.notInstalled, "")
        case .starting: (.starting, "")
        case .failed(let message): (.unavailable, String(message.prefix(500)))
        case .idle, .started:
          (engine.profile.qualification == .qualified ? .ready : .unqualified, "")
        }
      return ComputerStateEvent.Engine(engine: name, state: state, detail: detail)
    }
  }
}
