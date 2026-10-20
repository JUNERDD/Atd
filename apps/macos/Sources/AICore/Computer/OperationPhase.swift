import Foundation

/// Where one computer action is on its way to a known effect (plan §6.1, §6.4). The host
/// journals each phase before it moves on, so a crash, a restart or a lost reply leaves a
/// record of how far the action got.
///
/// - ``intent``: written before dispatch. Whether the engine was ever reached is not known yet.
/// - ``dispatched``: the engine accepted the steps; the target may have changed.
/// - ``settled``: the result is recorded (dispatched or not, verified or not); terminal.
/// - ``unknown``: the host lost the action between intent and settlement (timeout, worker
///   killed, host restart). Nothing may retry it blindly; only reconciliation settles it.
public enum OperationPhase: String, Codable, Sendable, CaseIterable {
  case intent
  case dispatched
  case settled
  case unknown

  /// Whether an action in this phase may move to `next`. Phases only move forward, and nothing
  /// leaves ``settled``: an action refused before dispatch settles from ``intent``, a lost one
  /// becomes ``unknown`` from ``intent`` or ``dispatched``, and reconciliation settles an
  /// ``unknown`` one.
  public func canAdvance(to next: OperationPhase) -> Bool {
    switch (self, next) {
    case (.intent, .dispatched), (.intent, .settled), (.intent, .unknown): true
    case (.dispatched, .settled), (.dispatched, .unknown): true
    case (.unknown, .settled): true
    default: false
    }
  }

  /// The first phase of every action.
  public static let initial: OperationPhase = .intent

  /// Whether the action's effect is still open: anything but ``settled``.
  public var isUnsettled: Bool { self != .settled }

  /// The phase a record left by a host generation that is gone is in now: an action that did not
  /// settle there may or may not have taken effect.
  public var afterHostLoss: OperationPhase { isUnsettled ? .unknown : .settled }
}
