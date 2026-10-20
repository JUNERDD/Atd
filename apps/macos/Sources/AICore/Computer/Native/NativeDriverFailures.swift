import AIComputerDriverKit
import Foundation

/// How a failure the driver reports maps onto the host's error codes and refusal reasons (driver
/// protocol v1, finalized by the host). `mayHaveDispatched` is the driver's own: when it is set
/// the step stops and is never replayed on another route.
public enum NativeDriverFailureMap {
  public struct Mapped: Equatable, Sendable {
    public let code: ComputerErrorCode
    public let reason: ComputerRefusalReason?
    public let mayHaveDispatched: Bool
  }

  /// A refused or failed `perform` of a `kind` step. A route limit is `noBackgroundRoute` with
  /// its reason; the target's own state keeps its code.
  public static func perform(_ failure: DriverFailure, step kind: ComputerStepKind) -> Mapped {
    let refusal: ComputerRefusalReason? =
      switch failure.code {
      case .noRoute, .capabilityUnavailable, .badRequest, .internalError: .noRoute
      case .pointerToolkit: .pointerToolkit
      case .opaqueSurface: .opaqueSurface
      case .textUnavailable: .textUnavailable
      case .keyUnavailable: .keyUnavailable
      case .menuUnavailable: .menuUnavailable
      case .secureInput: .secureInput
      case .dragAndDrop: .dragAndDrop
      case .hover: .hover
      case .minimized: .minimized
      case .offSpace: .offSpace
      case .fullScreen: .fullScreen
      case .userTyping: NativeTypingGuard.reason(for: kind)
      case .staleElement, .targetGone, .cancelled: nil
      }
    if let refusal {
      return Mapped(
        code: .noBackgroundRoute, reason: refusal, mayHaveDispatched: failure.mayHaveDispatched)
    }
    return Mapped(code: state(failure), reason: nil, mayHaveDispatched: failure.mayHaveDispatched)
  }

  /// A refused or failed read (`probe`, `snapshot`, `capture`, `prepare`), which sends no input.
  public static func read(_ failure: DriverFailure) -> Mapped {
    let code: ComputerErrorCode =
      switch failure.code {
      case .staleElement, .targetGone, .cancelled: state(failure)
      case .minimized, .offSpace, .fullScreen: .targetUnavailable
      case .capabilityUnavailable: .unsupported
      default: .engineFailed
      }
    let reason: ComputerRefusalReason? =
      switch failure.code {
      case .minimized: .minimized
      case .offSpace: .offSpace
      case .fullScreen: .fullScreen
      default: nil
      }
    return Mapped(code: code, reason: reason, mayHaveDispatched: false)
  }

  /// Whether the next rung may be tried after `failure`: the driver says nothing was dispatched
  /// and names a limit of the route, not of the target's state (placement, secure input, a stale
  /// element, a gone window) or of the person (typing), which no other rung changes.
  public static func degrades(_ failure: DriverFailure) -> Bool {
    guard !failure.mayHaveDispatched else { return false }
    switch failure.code {
    case .noRoute, .textUnavailable, .keyUnavailable, .menuUnavailable, .capabilityUnavailable,
      .pointerToolkit, .opaqueSurface, .hover:
      return true
    case .secureInput, .dragAndDrop, .minimized, .offSpace, .fullScreen, .userTyping,
      .staleElement, .targetGone, .cancelled, .badRequest, .internalError:
      return false
    }
  }

  /// Whether the driver refused only because the target process is still busy with an earlier
  /// action that outlived its deadline: nothing was sent, and the request may be tried again.
  public static func isBusy(_ failure: DriverFailure) -> Bool {
    failure.code == .cancelled && !failure.mayHaveDispatched
  }

  /// A stale element asks for a new observation, a gone window or process for a new target ref;
  /// a cancelled request that may have acted is cancelled, a busy target is busy.
  private static func state(_ failure: DriverFailure) -> ComputerErrorCode {
    switch failure.code {
    case .staleElement: .staleObservation
    case .targetGone: .targetChanged
    case .cancelled: failure.mayHaveDispatched ? .cancelled : .busy
    default: .engineFailed
    }
  }
}

/// The typing guard of the key-scope routes (plan I2, §4.2): a route that makes the target's
/// window key for its app must not start while the person types, or a keystroke of theirs could
/// land in the target. It waits once for 300 ms of quiet, at most one second, then refuses.
public enum NativeTypingGuard {
  /// How long the person must not have typed before a key scope opens.
  public static let quiet: Duration = .milliseconds(300)
  /// The longest the guard waits for that quiet, once.
  public static let longestWait: Duration = .seconds(1)
  public static let message = "The person is typing; Atd did not open a key scope."

  /// How long to wait before a key scope may open; nil when the person has been quiet long
  /// enough (or no input is known).
  public static func wait(lastInput: ContinuousClock.Instant?, now: ContinuousClock.Instant)
    -> Duration?
  {
    guard let lastInput else { return nil }
    let quietAt = lastInput + quiet
    guard now < quietAt else { return nil }
    return min(quietAt - now, longestWait)
  }

  /// The refusal reason a `kind` step names when the guard refuses it.
  public static func reason(for kind: ComputerStepKind) -> ComputerRefusalReason {
    kind == .type ? .textUnavailable : .keyUnavailable
  }
}
