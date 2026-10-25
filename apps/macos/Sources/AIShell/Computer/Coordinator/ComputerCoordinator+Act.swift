import AICore
import Foundation

/// `act`: one action as a short transaction in the fixed order of plan §6.1: admission before the
/// claim (``admit(_:request:)``), the target's own resources claimed within the deadline, the
/// target, its observation and the person checked again once claimed
/// (``revalidate(_:engine:execution:)``), the intent journaled, the steps dispatched under the
/// disturbance guard (``runSteps(_:request:engine:entry:observation:execution:subject:deadline:watch:)``),
/// the result journaled, and the claim released only once the effect converged. An action claims
/// the shared input only for a step it does in the foreground, for that step alone
/// (``ForegroundExecutor``), and is never held while the model thinks.
extension ComputerCoordinator {
  func act(_ request: HostRequestWire, action: ComputerActionWire) async -> HostReplyWire {
    let envelope = request.envelope
    guard let journal = host.journal, host.generation != nil else {
      return .failed(request, .locked, "This host does not hold the computer host journal.")
    }
    let running = executions[action.actionId]
    switch HostRequestPolicy.repeatDecision(
      actionId: action.actionId, runId: envelope.runId, operationId: envelope.operationId,
      journal: journal.entry(for: action.actionId), inFlight: running != nil)
    {
    case .run:
      break
    case .join:
      guard let running, running.runId == envelope.runId,
        running.operationId == envelope.operationId, let reply = running.reply
      else { return .failed(request, .unsupported, "The action id belongs to another operation.") }
      return HostReplyWire(identity: request.identity, outcome: await reply.value.outcome)
    case .replay(let result):
      return .ok(request, .actionResult(result))
    case .unknown:
      return .ok(request, .actionResult(Self.lost(action.actionId)))
    case .conflict:
      return .failed(request, .unsupported, "The action id belongs to another operation.")
    }
    let execution = ActionExecution(
      runId: envelope.runId, operationId: envelope.operationId, actionId: action.actionId,
      serviceEpoch: request.identity.serviceEpoch)
    executions[action.actionId] = execution
    let task = Task { await self.transact(request, action: action, execution: execution) }
    execution.reply = task
    let reply = await task.value
    executions[action.actionId] = nil
    logTiming(of: action, reply: reply, phases: execution.phases)
    refreshIfIdle()
    return reply
  }

  private func transact(
    _ request: HostRequestWire, action: ComputerActionWire, execution: ActionExecution
  ) async -> HostReplyWire {
    let deadline = deadline(of: request)
    let watchdog = Task { [weak execution] in
      try? await Task.sleep(until: deadline, clock: .continuous)
      guard !Task.isCancelled else { return }
      execution?.requestStop(ComputerFailure(.timeout, "The request's deadline passed."))
    }
    defer { watchdog.cancel() }
    let refuse = { (error: ComputerErrorWire) in
      HostReplyWire(identity: request.identity, outcome: .failed(error))
    }
    let engine: any ComputerEngine
    let ref: TargetRefWire
    do throws(ComputerFailure) {
      engine = try admit(action, request: request)
      ref = try targets.current(id: action.targetRefId, engineGeneration: engine.generation).ref
    } catch {
      return refuse(error.wire)
    }
    let claim: ResourceClaim
    switch await execution.claim(engine.resources(for: ref), on: arbiter, deadline: deadline) {
    case .success(let granted): claim = granted
    case .failure(let refusal): return refuse(Self.wire(refusal))
    }
    // Claimed: the target may have changed while the claim waited.
    let entry: TargetRegistry.Entry
    let observation: ObservationWire
    do throws(ComputerFailure) {
      (entry, observation) = try await revalidate(action, engine: engine, execution: execution)
      try await engine.validateConditions(action, baseline: observation)
      _ = try await revalidate(action, engine: engine, execution: execution)
    } catch {
      claim.release()
      invalidate(after: error, refId: ref.id)
      return refuse(error.wire)
    }
    guard let journal = host.journal, let generation = host.generation,
      (try? journal.append(record(action, request, generation, .intent))) != nil
    else {
      claim.release()
      return refuse(
        ComputerErrorWire(
          code: .engineFailed, message: "The host could not journal the action; nothing was sent."))
    }
    let subject = ProgressSubject(
      taskId: request.envelope.taskId, runId: execution.runId, operationId: execution.operationId,
      actionId: action.actionId, hostGeneration: generation,
      observationRefId: action.observationRefId, ref: entry.ref)
    // A write action is watched for disturbances from its first step to its end (plan §4.3).
    let watch =
      Self.writes(action) ? disturbance.watch(target: Self.processes(of: ref, engine)) : nil
    let (fold, remaining) = await runSteps(
      action, request: request, engine: engine, entry: entry, observation: observation,
      execution: execution, subject: subject, deadline: deadline, watch: watch)
    if let watch { disturbance.stop(watch) }
    let result = fold.result()
    var settled = record(action, request, generation, .settled)
    settled.result = try? JSONValue(encoding: result)
    if (try? journal.append(settled)) == nil {
      Self.log.error("The settled result of an action could not be journaled.")
    }
    needsRefresh = true
    reportEnd(subject, result: result)
    if let remaining {
      // The step never ended: its claim stays until it does, and the engine is stopped so it
      // ends; refs of that engine generation go stale.
      Task {
        await engines.stop(engine)
        targets.invalidate(engine: engine.id)
      }
      Task {
        await remaining.value
        claim.release()
      }
    } else {
      claim.release()
    }
    return .ok(request, .actionResult(result))
  }

  func record(
    _ action: ComputerActionWire, _ request: HostRequestWire, _ generation: Int,
    _ phase: OperationPhase
  ) -> HostJournalEntry {
    HostJournalEntry(
      actionId: action.actionId, runId: request.envelope.runId,
      operationId: request.envelope.operationId, hostGeneration: generation, phase: phase,
      at: .now)
  }

  static func writes(_ action: ComputerActionWire) -> Bool {
    action.steps.contains { $0.effect != .read }
  }

  /// The processes a person would use `ref` through, which the guard watches.
  static func processes(of ref: TargetRefWire, _ engine: any ComputerEngine) -> Set<pid_t> {
    engine.foregroundProcess(of: ref).map { [$0] } ?? []
  }
}
