import AICore
import Foundation

/// Who a progress frame is about: one action of one operation, on one target.
struct ProgressSubject {
  let taskId: String
  let runId: String
  let operationId: String
  let actionId: String
  let hostGeneration: Int
  let observationRefId: String?
  let ref: TargetRefWire
}

/// Turns the coordinator's lifecycle events into `computer.progress` frames for the service and
/// into marks of the live pointer (D8, D14, plan §3.4). `seq` grows across the host generation, so
/// it increases per run and per operation as the contract requires. The pointer only ever gets a
/// rect that ``ComputerScreenState/pointerPlacement(_:ref:)`` trusted; without one the mark clears.
final class ComputerProgressReporter {
  /// How long an in-progress frame stays valid without a newer one, and a final one.
  static let activeValidity: TimeInterval = 15
  static let endValidity: TimeInterval = 2
  private static let badgeCapacity = 32

  /// Sends a frame on the control stream (dropped while no connection is open).
  var send: ((ComputerProgressWire) -> Void)?
  private let pointer: ActivityPointerController
  private var seq = 0
  /// The latest geometry per mark, so verify and done frames stay where the step acted.
  private var geometry: [PointerKey: ComputerGeometryWire] = [:]
  private var actions: [PointerKey: PointerAction] = [:]
  private var badges: [(taskId: String, badge: String)] = []
  private var nextBadge = 0

  init(pointer: ActivityPointerController) {
    self.pointer = pointer
  }

  func report(
    _ subject: ProgressSubject, _ phase: ComputerProgressPhase, step: ComputerStepWire? = nil,
    geometry located: ComputerGeometryWire? = nil, verified: Bool = false,
    finishedUnverified: Bool = false
  ) {
    seq += 1
    let key = PointerKey(taskId: subject.taskId, targetRefId: subject.ref.id)
    if let located { geometry[key] = located }
    if let step { actions[key] = PointerAction(step) }
    let current = geometry[key]
    let action = actions[key] ?? .other
    let now = Date()
    let validity: TimeInterval =
      switch phase {
      case .cleared: 0
      case .done, .failed: Self.endValidity
      case .locating, .dispatching, .waiting, .verifying: Self.activeValidity
      }
    send?(
      ComputerProgressWire(
        taskId: subject.taskId, runId: subject.runId, operationId: subject.operationId,
        actionId: subject.actionId, hostGeneration: subject.hostGeneration, seq: seq, phase: phase,
        observationRefId: subject.observationRefId, validUntil: now.addingTimeInterval(validity),
        label: step?.kind, geometry: current ?? .unavailable))
    // An input that returned normally without verification keeps only its neutral dispatch
    // feedback. The wire result remains unknown; real failures still withdraw immediately.
    guard let pointerPhase = Self.pointerPhase(finishedUnverified ? .done : phase, action: action)
    else {
      geometry[key] = nil
      actions[key] = nil
      pointer.clear(key)
      return
    }
    if phase == .done || phase == .failed {
      geometry[key] = nil
      actions[key] = nil
    }
    let placement = ComputerScreenState.pointerPlacement(current, ref: subject.ref)
    pointer.show(
      PointerFrame(
        key: key, taskBadge: badge(for: subject.taskId), phase: pointerPhase,
        targetRect: placement?.rect, verified: verified,
        validUntil: now.addingTimeInterval(validity), sequence: seq, action: action),
      isCurrent: {
        placement != nil
          && ComputerScreenState.pointerPlacement(current, ref: subject.ref) == placement
      },
      observation: MonitorPointerObservation(geometry: current, ref: subject.ref))
  }

  /// Withdraws every mark, as a stop, a disconnect or quitting does.
  func clearAll() {
    geometry = [:]
    actions = [:]
    pointer.clearAll()
  }

  private static func pointerPhase(_ phase: ComputerProgressPhase, action: PointerAction)
    -> PointerPhase?
  {
    switch phase {
    case .locating: .locating
    case .dispatching: action.isTextInput ? .typingField : .dispatching
    case .waiting: .waiting
    case .verifying: .verifying
    case .done: .done
    case .failed: .failed
    case .cleared: nil
    }
  }

  /// A short number per task, so marks of concurrent tasks are told apart.
  private func badge(for taskId: String) -> String {
    if let index = badges.firstIndex(where: { $0.taskId == taskId }) {
      let entry = badges.remove(at: index)
      badges.append(entry)
      return entry.badge
    }
    nextBadge = nextBadge % 99 + 1
    badges.append((taskId, String(nextBadge)))
    if badges.count > Self.badgeCapacity { badges.removeFirst() }
    return String(nextBadge)
  }
}
