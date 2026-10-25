import AICore

extension ComputerCoordinator {
  /// Model observation has its own read-only lifetime and never refreshes the driver's action
  /// snapshots. Shared system sources take priority; target ids must belong to this exact run.
  func screenContext(_ request: HostRequestWire, operation: ScreenContextOperationWire) async
    -> HostReplyWire
  {
    let envelope = request.envelope
    guard previewConnected, !Task.isCancelled, !stopping,
      host.lock.isHeld, host.generation == request.identity.hostGeneration,
      previewServiceEpoch == request.identity.serviceEpoch, !envelope.unattended,
      envelope.grantRef == nil, envelope.executionId == "root:\(envelope.runId)",
      !cancelled.isCancelled(runId: envelope.runId, operationId: envelope.operationId)
    else { return .failed(request, .cancelled, "Visual monitoring is unavailable for this run.") }
    var sources: [ComputerVisualSourceWire] = []
    if operation.includeShared {
      sources = await sharing.images(
        taskId: envelope.taskId, runId: envelope.runId, limit: operation.limit)
    }
    let sharedIds = Set(sources.map(\.sourceId))
    let remaining = operation.limit - sources.count
    if remaining > 0 {
      sources += await previews.context(
        taskId: envelope.taskId, runId: envelope.runId,
        targetRefIds: operation.targetRefIds, limit: remaining)
    }
    guard previewConnected, !Task.isCancelled, !stopping,
      host.lock.isHeld, host.generation == request.identity.hostGeneration,
      previewServiceEpoch == request.identity.serviceEpoch,
      !cancelled.isCancelled(runId: envelope.runId, operationId: envelope.operationId)
    else { return .failed(request, .cancelled, "Visual monitoring ended during the read.") }
    sources = sources.compactMap { source in
      sharedIds.contains(source.sourceId)
        ? sharing.validate(source, taskId: envelope.taskId, runId: envelope.runId) : source
    }
    return .ok(
      request,
      .screenContext(
        sources: sources,
        sharedSources: sharing.cursors(taskId: envelope.taskId, runId: envelope.runId)))
  }
}
