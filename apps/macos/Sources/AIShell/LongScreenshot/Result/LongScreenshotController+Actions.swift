import AICore
import AppKit
import UniformTypeIdentifiers

/// The result card's footer (decisions D11, D12): each action works on the kept range as it was
/// when pressed and reports on its own button, the card staying.
extension LongScreenshotController {
  /// Writes the kept image at full native pixels as a PNG into the configured save folder, or
  /// prompts for a destination file when "Ask each time" is selected.
  func save(_ kept: LongScreenshotKept) {
    guard let source, !exportingActions.contains(.save) else { return }
    if let folder = saveFolderURL() {
      run(.save) { [self] generation in
        await exportSave(
          source: source, kept: kept, generation: generation, folder: folder, destination: nil)
      }
      return
    }
    exportingActions.insert(.save)
    let generation = generation
    let suggestedName = LongScreenshotExportRules.fileName(
      capturedAt: source.shot.capturedAt, encoding: .png)
    Task { [self] in
      let chosen = await systemPanels.chooseSaveFile(
        suggestedName: suggestedName, contentType: .png, aboveIsland: true)
      guard generation == self.generation else { return }
      island.restoreKeyboardAfterModal()
      guard let destination = chosen else {
        exportingActions.remove(.save)
        return
      }
      island.cardFeedback(.save, .working)
      let feedback = await exportSave(
        source: source, kept: kept, generation: generation, folder: nil, destination: destination)
      guard generation == self.generation else { return }
      exportingActions.remove(.save)
      if let feedback { island.cardFeedback(.save, feedback) }
    }
  }

  private func exportSave(
    source: LongScreenshotCardSource, kept: LongScreenshotKept, generation: Int, folder: URL?,
    destination: URL?
  ) async -> IslandRecording.CardFeedback? {
    guard let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept) else {
      return .failed(ShellStrings.shared.text(ScreenshotSaveStringKey.saveFailed))
    }
    do throws(ImageExportFailure) {
      let savedURL: URL
      if let destination {
        savedURL = try await CaptureExport.saveScreenshotToFile(
          image, scale: source.shot.scale, destination: destination)
      } else if let folder {
        savedURL = try await CaptureExport.saveScreenshot(
          image, scale: source.shot.scale, capturedAt: source.shot.capturedAt, long: true,
          in: folder)
      } else {
        return nil
      }
      guard generation == self.generation else { return nil }
      let message = String(
        format: ShellStrings.shared.text(RecordingOrchestrationStringKey.saved),
        locale: Locale(identifier: ShellStrings.shared.language.rawValue),
        SaveFolderDisplay.parentName(of: savedURL))
      return .done(message)
    } catch {
      guard generation == self.generation else { return nil }
      return .failed(ShellStrings.shared.text(ScreenshotSaveStringKey.saveFailed))
    }
  }

  /// The kept image at full pixels on the clipboard (PNG, with TIFF while it is not too large),
  /// encoded off the main actor, then written under the screenshot's clipboard claim.
  func copy(_ kept: LongScreenshotKept) {
    guard let source else { return }
    run(.copy) { [self] generation in
      guard
        let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept),
        let clipboard = await CaptureExport.longScreenshotClipboard(image, scale: source.shot.scale)
      else { return .failed(Self.text(.exportFailed)) }
      guard generation == self.generation else { return nil }
      let copied = arbiter.writeClipboard(as: .screenshot) { CaptureExport.copy(clipboard, to: $0) }
      return copied ? .done(Self.text(.copied)) : .failed(Self.text(.clipboardBusy))
    }
  }

  /// The kept image and its context in the panel's composer
  /// (``attach(_:capturedAt:generation:describe:)``).
  func attach(_ kept: LongScreenshotKept) {
    guard let source else { return }
    run(.attach) { [self] generation in
      guard
        let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept)
      else { return .failed(Self.text(.exportFailed)) }
      return await attach(image, capturedAt: source.shot.capturedAt, generation: generation) {
        LongScreenshotContext(
          source: source, kept: kept, pixelWidth: $0.width, pixelHeight: $0.height)
      }
    }
  }

  /// Runs `work` for `action`, once at a time: its button shows a spinner, then what `work`
  /// answers (nil: nothing, the card it was for has gone).
  private func run(
    _ action: CardAction,
    _ work: @escaping @MainActor (_ generation: Int) async -> IslandRecording.CardFeedback?
  ) {
    guard !exportingActions.contains(action) else { return }
    exportingActions.insert(action)
    island.cardFeedback(action, .working)
    let generation = generation
    Task {
      let feedback = await work(generation)
      guard generation == self.generation else { return }
      exportingActions.remove(action)
      if let feedback { island.cardFeedback(action, feedback) }
    }
  }

  /// Writes `image` and its context (`describe` for the file's pixel size) and attaches both to
  /// the conversation as one `resources.imported`, with the panel shown, as a recording's files
  /// are attached. Nil once another long screenshot took the card's place.
  func attach(
    _ image: CGImage, capturedAt: Date, generation: Int,
    describe: @escaping @Sendable (ScreenshotPixelSize) -> LongScreenshotContext
  ) async -> IslandRecording.CardFeedback? {
    let files: LongScreenshotFiles
    do throws(LongScreenshotFiles.Failure) {
      files = try await LongScreenshotFiles.write(
        image, capturedAt: capturedAt, describe: describe)
    } catch {
      return .failed(Self.text(error.reason))
    }
    defer { files.delete() }
    guard generation == self.generation else { return nil }
    do throws(BridgeError) {
      let imported = try await attachments.importPaths(files.all)
      guard generation == self.generation else { return nil }
      let event = ResourcesImportedEvent(
        batch: ImportBatch(files.all.map(ImportItem.init(fileURL:))), files: imported,
        folders: nil)
      showPanel()
      panelHost.send(.resourcesImported(event))
      guard imported.failures.isEmpty else { return .failed(Self.text(.exportFailed)) }
      return .done(Self.text(.attached))
    } catch {
      return .failed(error.message)
    }
  }
}
