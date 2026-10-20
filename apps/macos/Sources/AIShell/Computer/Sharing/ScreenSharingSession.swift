import AICore
import AppKit
@_weakLinked import ScreenCaptureKit

/// Independent system selections belong to one attended run. Native presentation and model
/// snapshots consume these streams without controlling their authorization or lifetime.
final class ScreenSharingSession: NSObject {
  final class Share {
    let runId: String
    let taskId: String
    let startOperation: String
    let ordinal: Int
    var id = UUID().uuidString.lowercased()
    var selecting = true
    var stream: SharedScreenStream?
    var opening: Task<Void, Never>?
    var label: String { ShellStrings.shared.text(.computerMonitorSharedSource, count: ordinal) }

    init(_ envelope: ExecutionEnvelopeWire, ordinal: Int) {
      runId = envelope.runId
      taskId = envelope.taskId
      startOperation = envelope.operationId
      self.ordinal = ordinal
    }
  }

  var shares: [Share] = []
  var observer: ScreenSharingPickerObserver?
  var pickerToken: String?
  var cleanup: Task<Void, Never>?
  var onSourceAdded: ((Share) -> Void)?
  var onSourceRemoved: ((String) -> Void)?
  var beforeSourceStart: (() async -> Void)?
  private var operations: [String: (runId: String, cancelled: Bool)] = [:]
  private var endings: [(runId: String, reason: ScreenShareReplyWire.Ended)] = []
  private var ordinal = 0

  func perform(
    _ operation: ScreenShareOperationWire, envelope: ExecutionEnvelopeWire,
    deadline: ContinuousClock.Instant
  ) async throws(ComputerFailure) -> ScreenShareReplyWire {
    if Task.isCancelled { return .ended(.cancelled) }
    guard !envelope.unattended, envelope.grantRef == nil,
      envelope.executionId == "root:\(envelope.runId)"
    else {
      throw ComputerFailure(.unsupported, "Screen sharing requires an attended parent task.")
    }
    if let owner = shares.first,
      owner.runId != envelope.runId || owner.taskId != envelope.taskId
    {
      if case .stop = operation { return .ended(.notStarted) }
      throw ComputerFailure(.busy, "Another task is sharing the screen.")
    }
    let id = envelope.operationId
    guard operations[id] == nil else {
      throw ComputerFailure(.busy, "This screen sharing operation is already pending.")
    }
    operations[id] = (envelope.runId, false)
    defer {
      if operation == .start, isCancelled(id),
        let current = shares.first(where: { $0.startOperation == id })
      {
        end(current, reason: .cancelled)
      }
      operations[id] = nil
    }
    switch operation {
    case .start:
      guard .now < deadline else { return .ended(.cancelled) }
      guard shares.count < 4, !shares.contains(where: \.selecting) else {
        throw ComputerFailure(
          .busy, "Up to four sources can be shared; finish the current picker first.")
      }
      ordinal += 1
      let current = Share(envelope, ordinal: ordinal)
      shares.append(current)
      endings.removeAll { $0.runId == envelope.runId }
      presentPicker()
      while contains(current), current.selecting {
        if isCancelled(id) || .now >= deadline {
          end(current, reason: .cancelled)
          break
        }
        try? await Task.sleep(for: .milliseconds(50))
      }
      return await read(
        envelope, after: nil, until: min(deadline, .now + .seconds(3)))
    case .read(let after, let timeoutMs):
      return await read(
        envelope, after: after, until: min(deadline, .now + .milliseconds(timeoutMs)))
    case .stop(let sourceId):
      let selected = shares.filter { sourceId == nil || $0.id == sourceId }
      guard !selected.isEmpty else {
        return shares.isEmpty ? .ended(.notStarted) : await read(envelope, after: nil, until: .now)
      }
      for current in selected { end(current, reason: .stopped) }
      await cleanup?.value
      return await read(envelope, after: nil, until: .now)
    }
  }

  func contains(_ current: Share) -> Bool { shares.contains { $0 === current } }

  func isCancelled(_ operation: String) -> Bool {
    Task.isCancelled || operations[operation]?.cancelled != false
  }

  func cancel(_ cancel: ComputerCancelWire) {
    for (id, operation) in operations
    where operation.runId == cancel.runId && (cancel.operationId == nil || cancel.operationId == id)
    { operations[id]?.cancelled = true }
    for current in shares where current.runId == cancel.runId {
      if cancel.operationId == nil {
        end(current, reason: cancel.reason == .finished ? .finished : .cancelled)
      } else if current.startOperation == cancel.operationId,
        operations[current.startOperation] != nil
      {
        end(current, reason: .cancelled)
      }
    }
  }

  func end(_ current: Share, reason: ScreenShareReplyWire.Ended) {
    guard contains(current) else { return }
    shares.removeAll { $0 === current }
    current.stream?.invalidate()
    current.opening?.cancel()
    onSourceRemoved?(current.id)
    endings.removeAll { $0.runId == current.runId }
    endings.append((current.runId, reason))
    if endings.count > 16 { endings.removeFirst() }
    if shares.isEmpty {
      pickerToken = nil
      SCContentSharingPicker.shared.isActive = false
      if let observer { SCContentSharingPicker.shared.remove(observer) }
      observer = nil
    }
    retire(current.stream, opening: current.opening)
  }

  func end(_ reason: ScreenShareReplyWire.Ended) {
    for current in shares { end(current, reason: reason) }
  }

  func shutdown() async {
    end(.disconnected)
    await cleanup?.value
  }

  func ending(_ runId: String) -> ScreenShareReplyWire.Ended {
    endings.last(where: { $0.runId == runId })?.reason ?? .notStarted
  }

  /// Serialize startup retirement and teardown so a replacement never overtakes its old stream.
  func retire(_ stream: SharedScreenStream?, opening: Task<Void, Never>?) {
    let previous = cleanup
    cleanup = Task {
      await previous?.value
      await opening?.value
      await stream?.stop()
    }
  }
}
