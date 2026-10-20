import AICore
import Foundation

/// Authorized sources outlive their presentation. The panel and model context each hold a
/// consumer on the same stream; neither is tied to a renderer document or the chat window.
final class ComputerPreviewCoordinator {
  var onChange: (() -> Void)?
  private var sources: [ComputerPreviewSession] = []
  private var cleanup: Task<Void, Never>?
  private var cleanupGeneration = 0
  private var presentedTaskId: String?
  private lazy var monitor = ComputerMonitorWindow { [weak self] active in
    self?.presentationChanged(active)
  }

  var metadata: [ComputerStateEvent.Preview] { sources.map(\.metadata) }

  func register(
    ref: TargetRefWire, taskId: String, runId: String, label: String,
    provider: ComputerPreviewSource, refusal: @escaping () -> PreviewReason?
  ) {
    guard
      !sources.contains(where: {
        $0.metadata.runId == runId && $0.ref == ref && $0.provider.identity == provider.identity
      })
    else { return }
    remove { $0.metadata.runId == runId && $0.ref?.bindingId == ref.bindingId }
    guard makeRoom() else { return }
    append(
      metadata: .init(
        sourceId: UUID().uuidString.lowercased(), taskId: taskId, runId: runId,
        label: label, kind: ref.browser == nil ? .native : .browser),
      ref: ref, provider: provider, refusal: refusal)
  }

  func registerShared(
    taskId: String, runId: String, sourceId: String, label: String,
    frames: NativeCaptureFrames, isCurrent: @escaping () -> Bool
  ) {
    removeShared(sourceId: sourceId)
    guard makeRoom() else { return }
    let provider = ComputerPreviewSource(
      identity: sourceId,
      validate: {
        guard isCurrent() else { throw ComputerFailure(.targetUnavailable, "The share ended.") }
      },
      start: { ComputerBorrowedPreview(frames: frames) })
    append(
      metadata: .init(
        sourceId: sourceId, taskId: taskId, runId: runId, label: label, kind: .native),
      ref: nil, provider: provider,
      refusal: { isCurrent() ? nil : .targetUnavailable })
  }

  func removeShared(sourceId: String) {
    remove { $0.ref == nil && $0.metadata.sourceId == sourceId }
  }

  func remove(runId: String) { remove { $0.metadata.runId == runId } }
  func remove(refId: String) { remove { $0.ref?.id == refId } }
  func remove(engine: ComputerEngineID) { remove { $0.ref?.engine == engine } }
  func removeAll() { remove { _ in true } }

  func stopAll() async {
    removeAll()
    monitor.close()
    await settleRetirements()
  }

  /// Register the shared source first, then await its evicted targets before starting capture.
  /// Target sessions capture this same predecessor when registered, before any startup.
  func settleRetirements() async {
    while let cleanup { await cleanup.value }
  }

  func show(taskId: String) -> Bool {
    guard sources.contains(where: { $0.metadata.taskId == taskId }) else { return false }
    presentedTaskId = taskId
    updatePresentation()
    monitor.show()
    presentationChanged(true)
    return true
  }

  func context(taskId: String, runId: String, targetRefIds: [String], limit: Int) async
    -> [ComputerVisualSourceWire]
  {
    let requested = Set(targetRefIds)
    let selected = sources.filter {
      $0.metadata.taskId == taskId && $0.metadata.runId == runId
        && $0.ref.map { requested.contains($0.id) } == true
    }.prefix(max(1, min(4, limit)))
    // Start all selected sources before awaiting one; each source still serializes its own work.
    let reads = selected.map { source in Task { await source.context() } }
    var result: [ComputerVisualSourceWire] = []
    for read in reads { result.append(await read.value) }
    return zip(selected, result).map { source, value in source.validateContext(value) }
  }

  private func makeRoom() -> Bool {
    guard sources.count >= 4 else { return true }
    guard let oldest = sources.first(where: { $0.ref != nil }) else { return false }
    remove { $0 === oldest }
    return true
  }

  private func append(
    metadata: ComputerStateEvent.Preview, ref: TargetRefWire?, provider: ComputerPreviewSource,
    refusal: @escaping () -> PreviewReason?
  ) {
    let source = ComputerPreviewSession(
      metadata: metadata, ref: ref, provider: provider, refusal: refusal, predecessor: cleanup)
    source.onInvalidation = { [weak self, weak source] in
      guard let source else { return }
      self?.remove { $0 === source }
    }
    sources.append(source)
    updatePresentation()
    onChange?()
  }

  private func remove(where matches: (ComputerPreviewSession) -> Bool) {
    let removed = sources.filter(matches)
    guard !removed.isEmpty else { return }
    sources.removeAll(where: matches)
    let stops = removed.map { $0.end() }
    let previous = cleanup
    cleanupGeneration += 1
    let generation = cleanupGeneration
    cleanup = Task { [weak self] in
      await previous?.value
      for stop in stops { await stop.value }
      if self?.cleanupGeneration == generation { self?.cleanup = nil }
    }
    updatePresentation()
    onChange?()
  }

  private func presentationChanged(_ active: Bool) {
    for source in sources {
      source.setPresentation(active && source.metadata.taskId == presentedTaskId)
    }
    if !active, !monitor.isOpen { presentedTaskId = nil }
  }

  private func updatePresentation() {
    let selected = sources.filter { $0.metadata.taskId == presentedTaskId }
    monitor.update(selected.map(\.display))
    for source in sources {
      source.setPresentation(monitor.isPresenting && source.metadata.taskId == presentedTaskId)
    }
  }
}
