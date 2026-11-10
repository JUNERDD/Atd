import AICore
import Foundation

/// Questions about a long screenshot, run by the panel's page as the recording's are
/// (`ScreenRecordingController+Asks`): the same `recording.ask` route with the `screenshot`
/// source, so the page labels the task as a screenshot's and keeps its ended asks apart from the
/// recording's. Their preparation and delivery state stays here, so losing the renderer document
/// cannot leave the card waiting for an answer that will never arrive.
extension LongScreenshotController {
  /// An ask (or a regeneration) about the kept range it names: the kept image and its context
  /// are written and imported, then the panel's page runs it (`recording.ask`) and reports the
  /// answer as it grows (`recording.answer`, ``updateAnswer(askID:phase:text:)``).
  func send(_ ask: LongScreenshotAsk) {
    guard let source, preparingAsks[ask.id] == nil, runningAsks[ask.id] == nil else { return }
    let kept = ask.kept
    let cover = CaptureExport.longScreenshotCover(source, kept: kept, mosaic: mosaic)
    preparingAsks[ask.id] = Task {
      guard
        let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept, cover: cover)
      else { return failAsk(ask.id, .exportFailed) }
      let files: LongScreenshotFiles
      do throws(LongScreenshotFiles.Failure) {
        files = try await LongScreenshotFiles.write(image, capturedAt: source.shot.capturedAt) {
          LongScreenshotContext(
            source: source, kept: kept, pixelWidth: $0.width, pixelHeight: $0.height)
        }
      } catch {
        return failAsk(ask.id, error.reason)
      }
      defer { files.delete() }
      guard let importing = beginImport(files.all, for: ask.id) else { return }
      let imported: [FileRef]
      do {
        // Once the import starts, cancellation must not end its wait and delete its files early:
        // the independent task finishes before this one's defer runs.
        let result = try await importing.value
        guard result.failures.isEmpty else { return failAsk(ask.id, .exportFailed) }
        imported = result.imported.map { FileRef($0.resource) }
      } catch {
        return failAsk(ask.id, .exportFailed)
      }
      deliver(ask, sourceID: source.id, files: imported)
    }
  }

  /// Admits an import only while the ask is still being prepared: a Stop meanwhile must not
  /// start one.
  private func beginImport(_ files: [URL], for askID: String)
    -> Task<ResourceImportResponse, any Error>?
  {
    guard !Task.isCancelled, preparingAsks[askID] != nil else { return nil }
    return Task { try await attachments.importPaths(files) }
  }

  private func deliver(_ ask: LongScreenshotAsk, sourceID: String, files: [FileRef]) {
    // Stop, a close or the document's unload can come while the files were imported.
    guard !Task.isCancelled, preparingAsks.removeValue(forKey: ask.id) != nil else { return }
    guard !files.isEmpty else {
      return island.updateAnswer(
        askID: ask.id, phase: .failed, text: Self.text(.exportFailed))
    }
    guard panelHost.isPageReady else {
      return island.updateAnswer(
        askID: ask.id, phase: .failed, text: Self.text(.answerInterrupted))
    }
    runningAsks[ask.id] = ""
    panelHost.send(
      .recordingAsk(
        RecordingAskEvent(
          askId: ask.id, source: .screenshot, sourceId: sourceID, question: ask.question,
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

  /// `recording.answer` for a long screenshot's ask: the card shows the answer whether or not it
  /// is on the island; an ask no longer running changes nothing.
  func updateAnswer(askID: String, phase: RecordingAnswer.Phase, text: String) {
    guard runningAsks[askID] != nil else { return }
    if phase.running { runningAsks[askID] = text } else { runningAsks.removeValue(forKey: askID) }
    island.updateAnswer(askID: askID, phase: phase, text: text)
  }

  private func failAsk(_ askID: String, _ reason: LongScreenshotResultStringKey) {
    guard !Task.isCancelled, preparingAsks.removeValue(forKey: askID) != nil else { return }
    island.updateAnswer(askID: askID, phase: .failed, text: Self.text(reason))
  }

  /// A document loss ends every pending answer, keeping any text already received.
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

  /// The card went, so its light tasks no longer have a consumer.
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
