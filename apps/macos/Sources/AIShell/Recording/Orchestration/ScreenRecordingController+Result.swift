import AICore
import AppKit
import UniformTypeIdentifiers

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
    let saveFolder = currentSaveFolderURL().map { SaveFolderDisplay.name(for: $0) }
    let source = RecordingCardSource(
      result, id: UUID().uuidString, saveFolder: saveFolder)
    let kept = RecordingKept(result, source: source)
    self.kept = kept
    switch settings.after {
    case .card:
      stage = .idle
      island.showResult(source)
    case .save:
      guard kept.hold() else { return }
      defer { kept.letGo() }
      await saveAfterStop(kept, range: result.fullRange, generation: generation)
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
    let generation = generation
    exportingActions.insert(action)
    if action == .save, let folder = currentSaveFolderURL() {
      island.cardFeedback(action, .working)
      Task {
        defer { kept.letGo() }
        defer { if generation == self.generation { exportingActions.remove(action) } }
        await save(kept, range: trim.range, to: folder, generation: generation, feedback: action)
      }
      return
    }
    if action == .save {
      let suggestedName = kept.result.take.movieName
      Task {
        defer { kept.letGo() }
        defer { if generation == self.generation { exportingActions.remove(action) } }
        let fileURL = await systemPanels.chooseSaveFile(
          suggestedName: suggestedName, contentType: .mpeg4Movie, aboveIsland: true)
        island.restoreKeyboardAfterModal()
        guard generation == self.generation, let fileURL else { return }
        island.cardFeedback(action, .working)
        await save(
          kept, range: trim.range, toFile: fileURL, generation: generation, feedback: action)
      }
      return
    }
    island.cardFeedback(action, .working)
    Task {
      defer { kept.letGo() }
      defer { if generation == self.generation { exportingActions.remove(action) } }
      switch action {
      case .save: break
      case .copy: await copy(kept, range: trim.range, generation: generation, feedback: action)
      case .attach: await attach(kept, range: trim.range, generation: generation, feedback: action)
      }
    }
  }

  /// Updates the kept result card's Save label after the recording save location changes.
  func refreshSaveFolder() {
    island.updateSaveFolder(currentSaveFolderURL().map { SaveFolderDisplay.name(for: $0) })
  }

  /// Current configured recording save folder, or `nil` when set to Ask each time.
  private func currentSaveFolderURL() -> URL? {
    RecordingSettingsMemory.load(from: defaults).folders.currentURL
  }

  /// Saves `range` after recording stops: writes immediately when a folder is set, or releases the
  /// processing capsule and prompts for a destination when set to Ask each time.
  private func saveAfterStop(
    _ kept: RecordingKept, range: ClosedRange<Double>, generation: Int
  ) async {
    if let folder = currentSaveFolderURL() {
      await save(kept, range: range, to: folder, generation: generation)
      return
    }
    island.release()
    let fileURL = await systemPanels.chooseSaveFile(
      suggestedName: kept.result.take.movieName, contentType: .mpeg4Movie, aboveIsland: true)
    guard generation == self.generation, let fileURL else { return }
    island.showProcessing()
    await save(kept, range: range, toFile: fileURL, generation: generation)
  }

  /// Saves `range` into `folder` under a name no file there has.
  private func save(
    _ kept: RecordingKept, range: ClosedRange<Double>, to folder: URL, generation: Int,
    feedback: CardAction? = nil
  ) async {
    do throws(RecordingError) {
      _ = try await RecordingExporter.save(kept.result, range: range, to: folder)
      guard generation == self.generation else { return }
      report(Self.text(.saved, SaveFolderDisplay.name(for: folder)), action: feedback)
    } catch {
      guard generation == self.generation else { return }
      report(RecordingEngineText.message(error), action: feedback, failed: true)
    }
  }

  /// Saves `range` directly to a user-chosen file destination.
  private func save(
    _ kept: RecordingKept, range: ClosedRange<Double>, toFile destination: URL, generation: Int,
    feedback: CardAction? = nil
  ) async {
    do throws(RecordingError) {
      let savedURL = try await RecordingExporter.save(
        kept.result, range: range, toFile: destination)
      guard generation == self.generation else { return }
      report(Self.text(.saved, SaveFolderDisplay.parentName(of: savedURL)), action: feedback)
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
      let folderName = currentSaveFolderURL().map { SaveFolderDisplay.name(for: $0) }
      var source = kept.source
      source.saveFolder = folderName
      island.showResult(source)
      island.updateSaveFolder(folderName)
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
