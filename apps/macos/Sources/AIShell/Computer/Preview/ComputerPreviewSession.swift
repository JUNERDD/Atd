import AICore
import Foundation

/// One authorized source with independent presentation and context consumers. Every restart
/// waits for the previous startup and stop, including a cancelled startup that returns late.
final class ComputerPreviewSession {
  let metadata: ComputerStateEvent.Preview
  let ref: TargetRefWire?
  let provider: ComputerPreviewSource
  let refusal: () -> PreviewReason?
  let display: ComputerMonitorSource
  var onInvalidation: (() -> Void)?
  private var ended = false
  private var revision = 0
  private var stream: (any ComputerPreviewStream)?
  private var presentation = false
  private var contextActive = false
  private var opening: Task<Void, Never>?
  private var refreshing: Task<Void, Never>?
  private var cleanup: Task<Void, Never>?
  private var lastValidation = Date.distantPast
  private var terminalReason: PreviewReason = .targetUnavailable
  private var reading: Task<ComputerPreviewFrame?, any Error>?
  private var lastContextSequence = 0

  init(
    metadata: ComputerStateEvent.Preview, ref: TargetRefWire?,
    provider: ComputerPreviewSource, refusal: @escaping () -> PreviewReason?,
    predecessor: Task<Void, Never>?
  ) {
    self.metadata = metadata
    self.ref = ref
    self.provider = provider
    self.refusal = refusal
    cleanup = predecessor
    display = ComputerMonitorSource(
      id: metadata.sourceId, label: metadata.label,
      kind: ref == nil ? .sharedScreen : metadata.kind == .browser ? .browser : .application)
    // Ties this monitor source to the agent pointer of the same task and target, so the monitor
    // draws the mark over the window it shows (only application windows carry a window id).
    if let ref, let windowId = ref.native?.windowId {
      MonitorPointerFeed.shared.link(
        display, key: PointerKey(taskId: metadata.taskId, targetRefId: ref.id), windowId: windowId)
    }
  }

  func setPresentation(_ active: Bool) {
    guard !ended, presentation != active else { return }
    presentation = active
    if active {
      ensureStarted()
    } else if !contextActive {
      stopCurrent(reason: .starting)
    } else {
      display.clearImage()
    }
  }

  func context() async -> ComputerVisualSourceWire {
    guard !ended else { return unavailable(terminalReason) }
    contextActive = true
    ensureStarted()
    await opening?.value
    let current = revision
    do {
      try await validate(current, force: true)
      guard let stream else { return unavailable(display.reason ?? .starting) }
      let frame = try await latest(stream)
      try check(current)
      if let reason = stream.nativeFrames?.snapshot.unavailable { return unavailable(reason) }
      guard let frame else { return unavailable(.starting) }
      lastContextSequence = frame.sequence
      return ComputerVisualSourceWire(
        sourceId: metadata.sourceId, label: metadata.label, sequence: frame.sequence,
        checkedAt: .now,
        content: .frame(
          capturedAt: frame.capturedAt, width: frame.width, height: frame.height, data: frame.data))
    } catch {
      if !ended, !(error is CancellationError) {
        invalidate(ComputerPreviewCoordinator.reason(error))
      }
      return unavailable(ended ? terminalReason : .starting)
    }
  }

  @discardableResult
  func end() -> Task<Void, Never> {
    if !ended {
      ended = true
      presentation = false
      contextActive = false
      stopCurrent(reason: terminalReason)
    }
    return cleanup ?? Task {}
  }

  /// A multi-source read may await other sources after this one's image is encoded.
  /// Recheck its admission at the common return boundary before any pixels leave the host.
  func validateContext(_ value: ComputerVisualSourceWire) -> ComputerVisualSourceWire {
    guard !ended else { return unavailable(terminalReason) }
    if let reason = refusal() {
      invalidate(reason)
      return unavailable(reason)
    }
    if let reason = stream?.nativeFrames?.snapshot.unavailable { return unavailable(reason) }
    return value
  }

  private func check(_ current: Int) throws {
    try Task.checkCancellation()
    guard !ended, revision == current, presentation || contextActive else {
      throw CancellationError()
    }
    if let reason = refusal() {
      invalidate(reason)
      throw CancellationError()
    }
  }

  private func ensureStarted() {
    guard !ended, stream == nil, opening == nil else { return }
    let previous = cleanup
    revision += 1
    let current = revision
    display.clear(.starting)
    opening = Task { [weak self] in
      await previous?.value
      guard let self else { return }
      await self.start(current)
    }
  }

  private func start(_ current: Int) async {
    var started: (any ComputerPreviewStream)?
    do {
      try await validate(current, force: true)
      let candidate = try await provider.start()
      started = candidate
      try await validate(current, force: true)
      stream = candidate
      display.attach(candidate.nativeFrames)
      opening = nil
      refreshing = Task { [weak self] in await self?.refresh(current, stream: candidate) }
    } catch {
      await started?.stop()
      guard revision == current, !ended else { return }
      opening = nil
      if !(error is CancellationError) {
        invalidate(ComputerPreviewCoordinator.reason(error))
      }
    }
  }

  private func validate(_ current: Int, force: Bool = false) async throws {
    try check(current)
    if force || Date().timeIntervalSince(lastValidation) >= 1 {
      try await provider.validate()
      try check(current)
      lastValidation = .now
    }
  }

  private func refresh(_ current: Int, stream: any ComputerPreviewStream) async {
    do {
      while true {
        try await validate(current)
        if let frames = stream.nativeFrames {
          display.setReason(frames.snapshot.unavailable)
        } else if presentation {
          // A pull-based frame is read only for the monitor: `context()` reads its own on demand,
          // and a read can cost a capture (an off-Space window goes through the driver).
          let frame = try await latest(stream)
          try check(current)
          try await display.present(frame) { [weak self] in
            guard let self else { return false }
            return (try? self.check(current)) != nil && self.presentation
          }
        }
        // Browser JPEG transport is pull based: one read/decode at a time, at most 30 fps.
        // Native pixels use their own display link; this loop only checks source admission.
        let interval: Duration =
          stream.nativeFrames == nil && presentation ? .milliseconds(34) : .milliseconds(250)
        try await Task.sleep(for: interval)
      }
    } catch {
      guard revision == current, !ended, !(error is CancellationError) else { return }
      invalidate(ComputerPreviewCoordinator.reason(error))
    }
  }

  private func latest(_ stream: any ComputerPreviewStream) async throws -> ComputerPreviewFrame? {
    if let reading { return try await reading.value }
    let current = revision
    let task = Task { try await stream.latest() }
    reading = task
    defer { if revision == current { reading = nil } }
    return try await task.value
  }

  private func unavailable(_ reason: PreviewReason) -> ComputerVisualSourceWire {
    ComputerVisualSourceWire(
      sourceId: metadata.sourceId, label: metadata.label, sequence: lastContextSequence,
      checkedAt: .now, content: .unavailable(reason))
  }

  private func invalidate(_ reason: PreviewReason) {
    guard !ended else { return }
    terminalReason = reason
    end()
    onInvalidation?()
  }

  private func stopCurrent(reason: PreviewReason) {
    revision += 1
    let startup = opening
    let refresh = refreshing
    let read = reading
    let previous = cleanup
    let oldStream = stream
    startup?.cancel()
    refresh?.cancel()
    read?.cancel()
    opening = nil
    refreshing = nil
    reading = nil
    stream = nil
    display.clear(reason)
    cleanup = Task {
      await previous?.value
      await startup?.value
      await refresh?.value
      _ = try? await read?.value
      await oldStream?.stop()
    }
  }
}
