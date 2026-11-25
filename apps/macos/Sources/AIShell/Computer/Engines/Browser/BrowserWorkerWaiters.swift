import Foundation
import MCP
import Synchronization

/// Why a call to the browser worker produced no reply of its own.
enum BrowserWorkerCallError: Error, Equatable {
  /// The worker process is gone; whatever the call sent may or may not have reached the page.
  case exited
  /// No reply within the call's limit; the request was cancelled and its effect is unknown.
  case timedOut
  /// The caller stopped waiting; `sent` says whether the request had already been handed to the
  /// MCP client (a write may then have reached the page).
  case cancelled(sent: Bool)
  /// The SDK refused the arguments (`isError` without structured content): nothing was sent.
  case rejected(String)
  /// A reply that is not the worker's result shape, or a transport failure mid-call.
  case failed(String)
  /// No worker could be started for the call, so nothing was sent.
  case unavailable(String)
  /// The call names element refs or a baseline of another worker generation; nothing was sent.
  case generationChanged
}

/// One-shot race box for one MCP tool call, non-generic to avoid Swift 6.2 Release optimizer
/// issues with generic actor/class deinits.
nonisolated final class BrowserWorkerCallWaiter: Sendable {
  enum Outcome: Sendable {
    case completed(CallTool.Result)
    case failed(any Error)
    case timedOut
    case cancelled
    case exited
  }

  private enum State {
    case pending
    case waiting(CheckedContinuation<Outcome, Never>)
    case resolved(Outcome)
  }

  private let state = Mutex<State>(.pending)

  func finish(_ outcome: Outcome) {
    let continuation: CheckedContinuation<Outcome, Never>? = state.withLock { current in
      switch current {
      case .pending:
        current = .resolved(outcome)
        return nil
      case .waiting(let continuation):
        current = .resolved(outcome)
        return continuation
      case .resolved:
        return nil
      }
    }
    continuation?.resume(returning: outcome)
  }

  func wait() async -> Outcome {
    await withCheckedContinuation { continuation in
      let resolved: Outcome? = state.withLock { current in
        switch current {
        case .pending:
          current = .waiting(continuation)
          return nil
        case .waiting:
          preconditionFailure("BrowserWorkerCallWaiter.wait() called twice")
        case .resolved(let outcome):
          return outcome
        }
      }
      if let resolved { continuation.resume(returning: resolved) }
    }
  }
}

/// One-shot race box for bounded lifecycle waits (`connect`, bounded `cancelRequest`).
nonisolated final class BrowserWorkerSignalWaiter: Sendable {
  enum Outcome: Sendable {
    case completed
    case failed(any Error)
    case timedOut
    case cancelled
    case exited
  }

  private enum State {
    case pending
    case waiting(CheckedContinuation<Outcome, Never>)
    case resolved(Outcome)
  }

  private let state = Mutex<State>(.pending)

  func finish(_ outcome: Outcome) {
    let continuation: CheckedContinuation<Outcome, Never>? = state.withLock { current in
      switch current {
      case .pending:
        current = .resolved(outcome)
        return nil
      case .waiting(let continuation):
        current = .resolved(outcome)
        return continuation
      case .resolved:
        return nil
      }
    }
    continuation?.resume(returning: outcome)
  }

  func wait() async -> Outcome {
    await withCheckedContinuation { continuation in
      let resolved: Outcome? = state.withLock { current in
        switch current {
        case .pending:
          current = .waiting(continuation)
          return nil
        case .waiting:
          preconditionFailure("BrowserWorkerSignalWaiter.wait() called twice")
        case .resolved(let outcome):
          return outcome
        }
      }
      if let resolved { continuation.resume(returning: resolved) }
    }
  }
}
