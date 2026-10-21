import AICore
import Foundation

/// An action's steps, dispatched one by one, then its postcondition (plan §6.1, §4.3). Before each
/// write step the host yields to the person (``interruption(_:engine:)``), and each write step runs
/// under the disturbance guard: what it changed for the person goes on the result, and a change
/// the guard attributes to the agent, made by a step that reached the target, ends the action
/// `disturbed` (``endDisturbed(_:step:route:foreground:request:engine:ref:run:fold:)``). A step
/// every background route refused may be done again in the foreground within the same guarded
/// step (``foreground(after:step:request:engine:ref:observation:context:execution:)``), and the
/// postcondition is then checked once the person's screen is back.
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
        report: { [weak self] event in self?.stepEvent(event, subject: subject, step: step) },
        phases: execution.phases)
      let guarded = step.effect == .read ? nil : watch
      if let guarded { disturbance.begin(guarded) }
      var end = await execution.perform(
        step, engine: engine, ref: ref, observation: observation.ref, context: context)
      var receipt = Self.receipt(of: end)
      // What the person had in front when the step began, before its background attempt: what
      // the foreground fallback and the R7 repair put back.
      let before = guarded.flatMap(disturbance.before)
      let fallback = await foreground(
        after: end, step: step, request: request, engine: engine, ref: ref,
        observation: observation.ref, context: context, execution: execution, before: before)
      if let fallback { (end, receipt) = fallback }
      // Whether the fallback brought the target forward, which its restore's receipt records; one
      // that stopped before, at the person's input or a refusal, changed nothing of theirs.
      let broughtForward = fallback?.receipt != nil
      var found = guarded.map { disturbance.end($0, receipt: receipt) } ?? []
      // What the background attempt changed is put back once it ended (R7): a step that did not
      // stop in time may still be acting.
      if !broughtForward, case .finished = end {
        found = await repairFront(
          found, before: before, target: Self.processes(of: ref, engine), request: request,
          deadline: deadline, execution: execution)
      }
      fold.disturbed(found)
      switch end {
      case .finished(.success(let outcome)):
        lastStepInvalidated = outcome.invalidated != nil
        if outcome.outcome != .notDispatched { markDispatched() }
        fold.complete(outcome.outcome, evidence: outcome.evidence)
        fold.downloaded(outcome.downloads)
        if let delivery = outcome.delivery { fold.delivered(delivery) }
        // The channel of the latest step that sent input.
        let route = outcome.route ?? outcome.receipt?.route
        if let route { fold.route = route }
        if let invalidated = outcome.invalidated {
          fold.invalidated = invalidated
          targets.invalidateObservation(refId: ref.id)
        }
        if found.anyByAgent, outcome.outcome != .notDispatched || outcome.receipt != nil {
          endDisturbed(
            found, step: step, route: route, foreground: outcome.delivery == .foreground,
            request: request, engine: engine, ref: ref, run: subject.runId, fold: &fold)
        }
      case .finished(.failure(let failure)):
        if failure.mayHaveDispatched {
          markDispatched()
          // A foreground step that may have sent input went to the foreground, finished or not.
          if broughtForward { fold.delivered(.foreground) }
        }
        invalidate(after: failure, refId: ref.id)
        // Only a step that may have reached the target can have disturbed the person, and a
        // foreground step that could not put the person's screen back; what the host put back
        // after a background step (R7) is no reason to end it.
        let disturbed =
          found.anyByAgent && (failure.mayHaveDispatched || broughtForward)
          && !Self.putBack(found, foreground: broughtForward, request: request)
        let stop = disturbed ? Self.disturbed(found, after: failure) : failure
        fold.stop(stop.wire, mayHaveDispatched: failure.mayHaveDispatched)
      case .unconverged(let remaining):
        markDispatched()
        if fallback != nil { fold.delivered(.foreground) }
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
        let context = EngineCheckContext(
          deadline: deadline, isStopping: { [weak execution] in execution?.stop != nil },
          phases: execution.phases)
        do throws(ComputerFailure) {
          let held = try await engine.check(
            postcondition, on: ref, baseline: observation, context: context)
          fold.postcondition = held ? .held : .notHeld(postcondition)
        } catch {
          // A stop ends the check `cancelled`; the action then reports why it stopped, as it does
          // for a stop just before the check.
          if error.code == .cancelled, let stop = execution.stop {
            fold.stop(stop.wire)
          } else {
            fold.postcondition = .failed(error.wire)
          }
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
  /// person (their target or their input in use), failed when it ended in error or uncertainty,
  /// done (with its completion only when verified) otherwise.
  func reportEnd(_ subject: ProgressSubject, result: ActionResultWire) {
    switch result.error?.code {
    case .cancelled?, .targetInUse?, .inputInUse?, .timeout?, .hostUnavailable?:
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
