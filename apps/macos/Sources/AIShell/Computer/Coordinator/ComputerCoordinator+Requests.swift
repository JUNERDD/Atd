import AICore

extension ComputerCoordinator {
  func serve(_ request: HostRequestWire) async -> HostReplyWire {
    if stopping { return .failed(request, .hostUnavailable, "Atd is quitting.") }
    if case .screenShare = request.op, Task.isCancelled || !previewConnected {
      return .ok(request, .screenShare(.ended(.disconnected)))
    }
    if let error = HostRequestPolicy.verify(
      request.identity, hostId: hostId, generation: host.generation)
    {
      return HostReplyWire(identity: request.identity, outcome: .failed(error))
    }
    noteEpoch(request.identity.serviceEpoch)
    let envelope = request.envelope
    switch request.op {
    case .screenContext(let operation):
      return await screenContext(request, operation: operation)
    case .screenShare(let operation):
      if cancelled.isCancelled(runId: envelope.runId, operationId: envelope.operationId) {
        return .ok(request, .screenShare(.ended(.cancelled)))
      }
      do throws(ComputerFailure) {
        return .ok(
          request,
          .screenShare(
            try await sharing.perform(
              operation, envelope: envelope, deadline: deadline(of: request))))
      } catch {
        return HostReplyWire(identity: request.identity, outcome: .failed(error.wire))
      }
    case .status(let actionIds):
      return status(request, actionIds: actionIds)
    case .release(let ref):
      // The run let go of the target, or its binding was deleted or changed.
      targets.invalidate(refId: ref.id)
      targets.release(refId: ref.id)
      previews.remove(refId: ref.id)
      await release([ref])
      return .ok(request, .released)
    case .targets, .observe, .act, .prepareAccess, .openAccess:
      if cancelled.isCancelled(runId: envelope.runId, operationId: envelope.operationId) {
        return .failed(request, .cancelled, "The run's computer work was cancelled.")
      }
      if engines.isEmpty {
        return .failed(request, .notQualified, "No computer engine is available in this build.")
      }
    }
    switch request.op {
    case .prepareAccess(let target): return await prepareAccess(request, target: target)
    case .openAccess(let access): return await openAccess(request, access: access)
    case .targets(let bindings): return await resolveTargets(request, bindings: bindings)
    case .observe(let operation): return await observe(request, operation)
    case .act(let action): return await act(request, action: action)
    case .status, .release, .screenShare, .screenContext:
      return .failed(request, .unsupported, "Already answered.")
    }
  }

}
