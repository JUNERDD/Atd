import AICore
import AppKit

/// After the recording (architecture R1, R9–R11, B4, B5): the take is processed and kept for its
/// result card, then handled as the settings say (the card, a save to the remembered folder, or
/// the conversation's composer). The card's footer actions and asks export the kept range;
/// ``RecordingKept`` keeps the files until nothing reads them.
extension ScreenRecordingController {
  /// A footer action of the result card.
  typealias CardAction = IslandRecording.CardAction

  /// A stopped take: processed under the processing capsule, kept, then shown, saved or attached.
  func process(_ take: RecordingTake, generation: Int) async {
    let result = await RecordingProcessor.process(take)
    guard generation == self.generation else { return RecordingKept.delete(result.take.folder) }
    let source = RecordingCardSource(
      result, id: UUID().uuidString,
      saveFolder: RecordOptionsCopy.folderName(settings.folders.current))
    let kept = RecordingKept(result, source: source)
    self.kept = kept
    switch settings.after {
    case .card:
      stage = .idle
      island.showResult(source)
    case .save:
      guard kept.hold() else { return }
      defer { kept.letGo() }
      await save(kept, range: result.fullRange, generation: generation)
      if generation == self.generation { stage = .idle }
    case .attach:
      guard kept.hold() else { return }
      defer { kept.letGo() }
      await attach(kept, range: result.fullRange, generation: generation)
      if generation == self.generation { stage = .idle }
    }
  }

  /// A footer action exports the kept range while the player, trim and answers remain visible.
  /// Each button owns its progress, so the same action cannot be submitted twice.
  func perform(_ action: CardAction, on trim: RecordingTrim) {
    guard let kept, stage == .idle, !exportingActions.contains(action), kept.hold() else { return }
    exportingActions.insert(action)
    let generation = generation
    island.cardFeedback(action, .working)
    Task {
      defer { kept.letGo() }
      defer { if generation == self.generation { exportingActions.remove(action) } }
      switch action {
      case .save: await save(kept, range: trim.range, generation: generation, feedback: action)
      case .copy: await copy(kept, range: trim.range, generation: generation, feedback: action)
      case .attach: await attach(kept, range: trim.range, generation: generation, feedback: action)
      }
    }
  }

  /// Saves `range` to the folder the recording began with (the card's Save names it), under a
  /// name no file there has.
  private func save(
    _ kept: RecordingKept, range: ClosedRange<Double>, generation: Int, feedback: CardAction? = nil
  ) async {
    let folders = settings.folders
    do throws(RecordingError) {
      _ = try await RecordingExporter.save(kept.result, range: range, to: folders.currentURL)
      guard generation == self.generation else { return }
      report(Self.text(.saved, RecordOptionsCopy.folderName(folders.current)), action: feedback)
    } catch {
      guard generation == self.generation else { return }
      report(RecordingEngineText.message(error), action: feedback, failed: true)
    }
  }

  /// Puts a movie of `range` on the clipboard as a file.
  private func copy(
    _ kept: RecordingKept, range: ClosedRange<Double>, generation: Int, feedback: CardAction
  ) async {
    do throws(RecordingError) {
      let file = try await RecordingExporter.clipboardFile(for: kept.result, range: range)
      guard generation == self.generation else { return }
      let copied = arbiter.writeClipboard(as: .clipboardWrite) { pasteboard in
        pasteboard.clearContents()
        _ = pasteboard.writeObjects(RecordingExporter.pasteboardWriters(for: file))
      }
      guard generation == self.generation else { return }
      report(Self.text(copied ? .copied : .clipboardBusy), action: feedback, failed: !copied)
    } catch {
      guard generation == self.generation else { return }
      report(RecordingEngineText.message(error), action: feedback, failed: true)
    }
  }

  /// Attaches `range` to the conversation: its movie, context and key frames go to the panel's
  /// composer as one `resources.imported` with the panel shown. The exporter keeps them within
  /// one import's ``AttachmentRules/maxPathsPerImport``; the composer takes them when the draft
  /// has room for all and otherwise refuses the group with its own message in that panel.
  private func attach(
    _ kept: RecordingKept, range: ClosedRange<Double>, generation: Int, feedback: CardAction? = nil
  ) async {
    let files: RecordingExportFiles
    do throws(RecordingError) {
      files = try await RecordingExporter.files(for: kept.result, range: range, purpose: .attach)
    } catch {
      guard generation == self.generation else { return }
      return report(RecordingEngineText.message(error), action: feedback, failed: true)
    }
    guard generation == self.generation else { return }
    do throws(BridgeError) {
      let imported = try await attachments.importPaths(files.all)
      guard generation == self.generation else { return }
      let event = ResourcesImportedEvent(
        batch: ImportBatch(files.all.map(ImportItem.init(fileURL:))), files: imported, folders: nil)
      showPanel()
      panelHost.send(.resourcesImported(event))
      if !imported.failures.isEmpty {
        report(RecordingEngineText.text(.errorExport), action: feedback, failed: true)
      } else if files.movieOmitted {
        report(RecordingEngineText.text(.exportVideoTooLarge), action: feedback, failed: true)
      } else {
        report(Self.text(.attached), action: feedback)
      }
    } catch {
      guard generation == self.generation else { return }
      report(error.message, action: feedback, failed: true)
    }
  }

  private func report(_ message: String, action: CardAction?, failed: Bool = false) {
    if let action {
      island.cardFeedback(action, failed ? .failed(message) : .done(message))
    } else {
      island.showStatus(message, kind: failed ? .failed : .done)
    }
  }

  // MARK: The last recording

  /// The status menu's "Show Last Recording": the last result's card again, with its trim and
  /// answers, while no recording runs and the card is not already up. Nil otherwise.
  var lastRecordingAction: (() -> Void)? {
    guard kept != nil, stage == .idle, island.showing == nil || island.showing == .status else {
      return nil
    }
    return { [weak self] in
      guard let self, let kept, stage == .idle else { return }
      island.showResult(kept.source)
    }
  }

  /// The next recording begins, or the app quits: the last result is no longer offered, its
  /// card and asks go, and its files once nothing reads them.
  func dropLastRecording() {
    island.release()
    island.forgetCard()
    cancelAsks()
    exportingActions.removeAll()
    kept?.drop()
    kept = nil
  }
}
