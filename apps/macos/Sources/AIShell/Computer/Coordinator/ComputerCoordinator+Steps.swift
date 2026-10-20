import AICore
import Foundation

/// An action's steps, dispatched one by one, then its postcondition (plan §6.1, §4.3). Before each
/// write step the host yields to the person (``interruption(_:engine:)``), and each write step runs
/// under the disturbance guard: what it changed for the person goes on the result, and a change
/// the guard attributes to the agent, made by a step that reached the target, ends the action
/// `disturbed` (``endDisturbed(_:step:route:engine:ref:fold:)``).
extension ComputerCoordinator {
  /// Returns the step still running when one did not stop in time.
  func runSteps(
    _ action: ComputerActionWire, request: HostRequestWire, engine: any ComputerEngine,
    entry: TargetRegistry.Entry, observation: ObservationWire, execution: ActionExecution,
    subject: ProgressSubject, deadline: ContinuousClock.Instant, watch: DisturbanceGuard.Watch?
  ) async -> (ActionResultFold, Task<Void, Never>?) {
    var fold = ActionResultFold(actionId: action.actionId, steps: action.steps)
    var lastStepInvalidated = false
    var journaled = false
    func markDispatched() {
      guard !journaled else { return }
      journaled = true
      _ = try? host.journal?.append(record(action, request, subject.hostGeneration, .dispatched))
    }
    let ref = entry.ref
    for (index, step) in action.steps.enumerated() {
      if let stop = execution.stop {
        fold.stop(stop.wire)
        break
      }
      if step.effect != .read, let interruption = await interruption(ref, engine: engine) {
        invalidate(after: interruption, refId: ref.id)
        fold.stop(interruption.wire)
        break
      }
      progress.report(
        subject, step.kind == .wait ? .waiting : .locating, step: step,
        geometry: step.kind == .wait ? nil : .unavailable)
      let context = EngineStepContext(
        taskId: subject.taskId, runId: subject.runId, operationId: subject.operationId,
        actionId: action.actionId, stepIndex: index, surfaceRefId: action.surfaceRefId,
        unattended: request.envelope.unattended, typing: typing.options, deadline: deadline,
        isStopping: { [weak execution] in execution?.stop != nil },
        lastPersonInput: { [weak self] in self?.disturbance.lastPersonInput() },
        report: { [weak self] event in self?.stepEvent(event, subject: subject, step: step) })
      let guarded = step.effect == .read ? nil : watch
      if let guarded { disturbance.begin(guarded) }
      let end = await execution.perform(
        step, engine: engine, ref: ref, observation: observation.ref, context: context)
      let found = guarded.map { disturbance.end($0, receipt: Self.receipt(of: end)) } ?? []
      fold.disturbed(found)
      switch end {
      case .finished(.success(let outcome)):
        lastStepInvalidated = outcome.invalidated != nil
        if outcome.outcome != .notDispatched { markDispatched() }
        fold.complete(outcome.outcome, evidence: outcome.evidence)
        fold.downloaded(outcome.downloads)
        if let delivery = outcome.delivery { fold.delivery = delivery }
        // The channel of the latest step that sent input.
        let route = outcome.route ?? outcome.receipt?.route
        if let route { fold.route = route }
        if let invalidated = outcome.invalidated {
          fold.invalidated = invalidated
          targets.invalidateObservation(refId: ref.id)
        }
        if found.anyByAgent, outcome.outcome != .notDispatched || outcome.receipt != nil {
          endDisturbed(found, step: step, route: route, engine: engine, ref: ref, fold: &fold)
        }
      case .finished(.failure(let failure)):
        if failure.mayHaveDispatched { markDispatched() }
        invalidate(after: failure, refId: ref.id)
        // Only a step that may have reached the target can have disturbed the person.
        let stop =
          found.anyByAgent && failure.mayHaveDispatched
          ? Self.disturbed(found, after: failure) : failure
        fold.stop(stop.wire, mayHaveDispatched: failure.mayHaveDispatched)
      case .unconverged(let remaining):
        markDispatched()
        let stop = execution.stop ?? ComputerFailure(.cancelled, "The step was cancelled.")
        fold.stop(
          ComputerErrorWire(
            code: stop.code,
            message: stop.message + " The step did not stop in time; its effect is unknown."),
          mayHaveDispatched: true)
        targets.invalidate(refId: ref.id)
        return (fold, remaining)
      }
      if fold.isStopped { break }
    }
    if !fold.isStopped, let postcondition = action.postcondition {
      progress.report(subject, .verifying)
      switch preparePostcondition(
        action, condition: postcondition, ref: ref, engine: engine, execution: execution,
        deadline: deadline, completedSteps: fold.nextStep, lastStepInvalidated: lastStepInvalidated)
      {
      case .held: fold.postcondition = .held
      case .stopped(let failure): fold.stop(failure.wire)
      case .check:
        do throws(ComputerFailure) {
          let held = try await engine.check(postcondition, on: ref, baseline: observation)
          fold.postcondition = held ? .held : .notHeld
        } catch {
          fold.postcondition = .failed(error.wire)
        }
      }
    }
    return (fold, nil)
  }

  private func stepEvent(_ event: EngineStepEvent, subject: ProgressSubject, step: ComputerStepWire)
  {
    switch event {
    case .located(let geometry): progress.report(subject, .locating, step: step, geometry: geometry)
    case .dispatching(let geometry):
      progress.report(subject, .dispatching, step: step, geometry: geometry)
    case .waiting: progress.report(subject, .waiting, step: step)
    }
  }

  /// The last frame of an action: withdrawn when it was stopped from outside or yielded to the
  /// person, failed when it ended in error or uncertainty, done (with its completion only when
  /// verified) otherwise.
  func reportEnd(_ subject: ProgressSubject, result: ActionResultWire) {
    switch result.error?.code {
    case .cancelled?, .targetInUse?, .timeout?, .hostUnavailable?:
      progress.report(subject, .cleared)
    case .some:
      progress.report(subject, .failed)
    case nil:
      let failed = result.effect == .partial || result.effect == .unknown
      progress.report(
        subject, failed ? .failed : .done,
        geometry: result.invalidated == nil ? nil : .unavailable,
        verified: result.effect == .verified,
        finishedUnverified: result.effect == .unknown && result.dispatch == .settled)
    }
  }
}
