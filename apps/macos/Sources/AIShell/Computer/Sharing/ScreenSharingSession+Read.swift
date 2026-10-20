import AICore
import Foundation

extension ScreenSharingSession {
  /// Complete membership, independent of the inference image limit.
  func cursors(taskId: String, runId: String) -> [ScreenCursorWire] {
    shares.filter { $0.taskId == taskId && $0.runId == runId }.map {
      ScreenCursorWire(sourceId: $0.id, sequence: $0.stream?.output.snapshot.sequence ?? 0)
    }
  }

  /// Revoke an earlier encoded result if another source's asynchronous read outlives it.
  func validate(_ source: ComputerVisualSourceWire, taskId: String, runId: String)
    -> ComputerVisualSourceWire?
  {
    guard
      let current = shares.first(where: {
        $0.id == source.sourceId && $0.taskId == taskId && $0.runId == runId
      })
    else { return nil }
    guard let reason = current.stream?.output.snapshot.unavailable else { return source }
    return .init(
      sourceId: source.sourceId, label: source.label, sequence: source.sequence,
      checkedAt: .now, content: .unavailable(reason))
  }

  func read(
    _ envelope: ExecutionEnvelopeWire, after: [ScreenCursorWire]?,
    until deadline: ContinuousClock.Instant
  ) async -> ScreenShareReplyWire {
    while true {
      let current = shares.filter { $0.taskId == envelope.taskId && $0.runId == envelope.runId }
      guard !current.isEmpty else { return .ended(ending(envelope.runId)) }
      if isCancelled(envelope.operationId) { return .ended(.cancelled) }
      let changed =
        current.contains { share in
          guard let output = share.stream?.output else { return false }
          let snapshot = output.snapshot
          guard let after else { return snapshot.unavailable != .starting }
          return snapshot.unavailable != nil
            || after.first(where: { $0.sourceId == share.id })?.sequence != snapshot.sequence
        } || after.map { $0.count != current.count } == true
      if changed || .now >= deadline {
        let sources = await images(taskId: envelope.taskId, runId: envelope.runId, after: after)
        if isCancelled(envelope.operationId) { return .ended(.cancelled) }
        return sources.isEmpty ? .ended(ending(envelope.runId)) : .sharing(sources)
      }
      try? await Task.sleep(for: .milliseconds(50))
    }
  }

  /// Encoding is demand-driven and separate from capture. Recheck membership after suspension;
  /// a source replacement cannot smuggle a picture from its previous filter into the result.
  func images(taskId: String, runId: String, after: [ScreenCursorWire]? = nil, limit: Int = 4)
    async -> [ComputerVisualSourceWire]
  {
    var result: [ComputerVisualSourceWire] = []
    for current in shares.filter({ $0.taskId == taskId && $0.runId == runId }).prefix(limit) {
      let id = current.id
      let output = current.stream?.output
      let sequence = output?.snapshot.sequence ?? 0
      let checkedAt = output?.snapshot.checkedAt ?? .now
      let unavailable = output?.snapshot.unavailable ?? (output == nil ? .starting : nil)
      let content: ComputerVisualSourceWire.Content
      var actualSequence = sequence
      if let unavailable {
        content = .unavailable(unavailable)
      } else if after?.first(where: { $0.sourceId == id })?.sequence == sequence {
        content = .unchanged
      } else if let image = await output?.image() {
        actualSequence = image.sequence
        content = .frame(
          capturedAt: image.capturedAt, width: image.width, height: image.height, data: image.data)
      } else {
        content = .unavailable(output?.snapshot.unavailable ?? .captureFailed)
      }
      guard contains(current), current.id == id, !Task.isCancelled else { continue }
      result.append(
        .init(
          sourceId: id, label: current.label, sequence: actualSequence,
          checkedAt: checkedAt, content: content))
    }
    return result.compactMap { validate($0, taskId: taskId, runId: runId) }
  }
}
