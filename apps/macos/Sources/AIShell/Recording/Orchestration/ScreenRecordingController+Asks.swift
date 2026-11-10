import AICore
import Foundation

/// Questions keep their preparation and delivery state with the recording, so losing the
/// renderer document cannot leave the result card waiting for an answer that will never arrive.
extension ScreenRecordingController {
  /// An ask (or a regeneration) about the kept range: its key frames and context are imported,
  /// then the panel's page runs it (`recording.ask`) and reports the answer as it grows
  /// (`recording.answer`, ``updateAnswer(askID:phase:text:)``).
  func send(_ ask: RecordingAsk) {
    guard let kept, preparingAsks[ask.id] == nil, runningAsks[ask.id] == nil,
      kept.hold()
    else { return }
    let range = ask.range.range
    // Register the reader before scheduling: an immediate replacement must keep its files
    // until this task runs its defer, even if it was cancelled before its first instruction.
    preparingAsks[ask.id] = Task.detached(priority: Task.currentPriority) { [self] in
      defer { kept.letGo() }
      guard !Task.isCancelled else { return }
      let files: RecordingExportFiles
      do throws(RecordingError) {
        files = try await RecordingExporter.files(
          for: kept.result, range: range, purpose: .ask)
      } catch {
        if !Task.isCancelled { await failAsk(ask.id) }
        return
      }
      // A completed import owns copies. A transport failure cannot prove the service stopped
      // reading these paths, so in that case leave the export with the take as before.
      var canDeleteExport = true
      defer { if canDeleteExport { RecordingKept.delete(files.folder) } }
      guard !Task.isCancelled else { return }
      let imported: [FileRef]
      guard let importing = await beginImport(files.all, for: ask.id) else { return }
      canDeleteExport = false
      do {
        // Once import starts, cancellation must not end the HTTP wait and release its source
        // files early. This independent task finishes before the reader's defer can run.
        let result = try await importing.value
        canDeleteExport = true
        guard !Task.isCancelled else { return }
        guard result.failures.isEmpty else { return await failAsk(ask.id) }
        imported = result.imported.map { FileRef($0.resource) }
      } catch {
        if !Task.isCancelled { await failAsk(ask.id) }
        return
      }
      guard !Task.isCancelled else { return }
      await deliver(ask, recordingID: kept.source.id, files: imported)
    }
  }

  /// Admit an import atomically with Stop on MainActor. A cancelled preparation must not
  /// start a new independent import while its final handoff is waiting for the UI actor.
  private func beginImport(_ files: [URL], for askID: String)
    -> Task<ResourceImportResponse, any Error>?
  {
    guard !Task.isCancelled, preparingAsks[askID] != nil else { return nil }
    return Task { try await attachments.importPaths(files) }
  }

  private func deliver(_ ask: RecordingAsk, recordingID: String, files: [FileRef]) {
    // Stop or replacement can happen while this delivery is waiting for MainActor.
    guard !Task.isCancelled, preparingAsks.removeValue(forKey: ask.id) != nil else { return }
    guard !files.isEmpty else {
      return island.updateAnswer(
        askID: ask.id, phase: .failed, text: RecordingEngineText.text(.errorExport))
    }
    guard panelHost.isPageReady else {
      return island.updateAnswer(
        askID: ask.id, phase: .failed, text: Self.text(.answerInterrupted))
    }
    runningAsks[ask.id] = ""
    panelHost.send(
      .recordingAsk(
        RecordingAskEvent(
          askId: ask.id, source: .recording, sourceId: recordingID, question: ask.question,
          files: files)),
      scope: .document)
  }

  /// The card stopped an ask: the page stops its run; one not sent yet never is.
  func stopAsk(_ askID: String) {
    if let preparing = preparingAsks.removeValue(forKey: askID) {
      preparing.cancel()
      return
    }
    runningAsks.removeValue(forKey: askID)
    panelHost.send(.recordingAskStop(.init(askId: askID)), scope: .document)
  }

  /// `recording.answer`: the card shows the answer whether or not it is on the island.
  func updateAnswer(askID: String, phase: RecordingAnswer.Phase, text: String) {
    guard runningAsks[askID] != nil else { return }
    if phase.running { runningAsks[askID] = text } else { runningAsks.removeValue(forKey: askID) }
    island.updateAnswer(askID: askID, phase: phase, text: text)
  }

  private func failAsk(_ askID: String) {
    guard !Task.isCancelled, preparingAsks.removeValue(forKey: askID) != nil else { return }
    island.updateAnswer(askID: askID, phase: .failed, text: RecordingEngineText.text(.errorExport))
  }

  /// A document loss must end every pending answer, keeping any text already received.
  func pageDidUnload() {
    let interrupted = Self.text(.answerInterrupted)
    for askID in preparingAsks.keys {
      island.updateAnswer(askID: askID, phase: .failed, text: interrupted)
    }
    for (askID, text) in runningAsks {
      island.updateAnswer(
        askID: askID, phase: .failed, text: text.isEmpty ? interrupted : text + "\n\n" + interrupted
      )
    }
    cancelPreparations()
    runningAsks.removeAll()
  }

  /// The recording was discarded or replaced, so its light tasks no longer have a consumer.
  func cancelAsks() {
    for askID in runningAsks.keys {
      panelHost.send(.recordingAskStop(.init(askId: askID)), scope: .document)
    }
    cancelPreparations()
    runningAsks.removeAll()
  }

  private func cancelPreparations() {
    let preparing = preparingAsks
    preparingAsks.removeAll()
    for task in preparing.values { task.cancel() }
  }
}
