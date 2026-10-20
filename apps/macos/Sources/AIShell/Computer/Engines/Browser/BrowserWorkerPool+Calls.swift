import AICore
import Foundation
import MCP

/// The worker's calls as the host's failures, for everything that talks to a profile's worker:
/// the engine's steps and reads, and the access operation that opens a website's page.
extension BrowserWorkerPool {
  /// ``call(_:_:_:timeout:pinned:)`` with the call's own failures as the host's. `writes` says
  /// whether the tool can change the page, which decides whether a call that lost its reply may
  /// have reached it.
  func invoke(
    _ instance: ManagedChromeInstance, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, writes: Bool, pinned: Int? = nil
  ) async throws(ComputerFailure) -> (reply: BrowserWorkerReply, generation: Int) {
    do {
      return try await call(instance, tool, arguments, timeout: timeout, pinned: pinned)
    } catch {
      switch error {
      case .generationChanged:
        throw ComputerFailure(
          .staleObservation, "The browser worker restarted since the observation; observe again.")
      case .exited:
        throw ComputerFailure(
          .engineFailed, "The browser worker exited during \(tool).", mayHaveDispatched: writes)
      case .timedOut:
        throw ComputerFailure(
          .timeout, "The browser worker did not answer \(tool) in time.",
          mayHaveDispatched: writes)
      case .rejected(let message):
        throw ComputerFailure(.unsupported, "The browser worker refused \(tool): \(message)")
      case .failed(let message):
        throw ComputerFailure(.engineFailed, message, mayHaveDispatched: writes)
      case .unavailable(let message):
        throw ComputerFailure(.engineFailed, message)
      }
    }
  }
}

extension BrowserWorkerReply {
  /// This reply when the call succeeded, or its failure with the worker's own word on whether it
  /// dispatched. The worker's `notFound` names the page (refs always come from an observation),
  /// so the page closed: the target changed.
  func checked(_ tool: String) throws(ComputerFailure) -> BrowserWorkerReply {
    guard !ok else { return self }
    let code = error.map { Self.hostCode($0.code) } ?? .engineFailed
    let message = error?.message ?? "The browser worker failed \(tool)."
    throw ComputerFailure(
      code == .notFound ? .targetChanged : code, message, mayHaveDispatched: dispatched)
  }
}
