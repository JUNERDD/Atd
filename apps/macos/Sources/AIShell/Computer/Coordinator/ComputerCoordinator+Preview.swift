import AICore

extension ComputerCoordinator {
  /// Offers the observed target to the live monitor. A native target's preview is a direct
  /// screen capture, so it needs Screen Recording and, for an unattended run, the capture consent
  /// the person prepared in Settings (plan §8.3); a browser page's comes from the browser.
  func registerPreview(
    _ request: HostRequestWire, ref: TargetRefWire, observation: ObservationWire,
    engine: any ComputerEngine
  ) async {
    guard
      !cancelled.isCancelled(
        runId: request.envelope.runId,
        operationId: request.envelope.operationId),
      let provider = engine as? any ComputerPreviewProviding,
      let entry = try? targets.current(ref, engineGeneration: engine.generation)
    else { return }
    let kind = entry.binding.kind
    let captures = kind == .native
    if captures, request.envelope.unattended, !captureConsent.isPrepared { return }
    guard let source = try? await provider.previewSource(ref, observation: observation) else {
      return
    }
    let runId = request.envelope.runId
    let refusal: () -> PreviewReason? = { [weak self, weak engine] in
      guard let self, !self.stopping, self.previewConnected,
        self.previewServiceEpoch == request.identity.serviceEpoch
      else { return .disconnected }
      guard self.host.lock.isHeld, self.host.generation == ref.hostGeneration else {
        return .locked
      }
      if ComputerScreenState.writeBlock() != nil { return .locked }
      if ComputerScreenState.missingPermission(kind: kind, screenshot: captures) != nil {
        return .permission
      }
      guard let engine,
        !self.cancelled.isCancelled(runId: runId, operationId: "preview"),
        (try? self.targets.current(ref, engineGeneration: engine.generation)) != nil
      else { return .targetUnavailable }
      return nil
    }
    guard refusal() == nil,
      !cancelled.isCancelled(runId: runId, operationId: request.envelope.operationId)
    else { return }
    previews.register(
      ref: ref, taskId: request.envelope.taskId, runId: runId,
      label: entry.binding.label, provider: source, refusal: refusal)
  }
}
