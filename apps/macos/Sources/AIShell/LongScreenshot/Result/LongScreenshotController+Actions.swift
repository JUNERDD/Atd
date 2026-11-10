import AICore
import AppKit

/// The result card's footer (decisions D11, D12): each action works on the kept range as it was
/// when pressed and reports on its own button, the card staying.
extension LongScreenshotController {
  /// The kept image at full pixels on the clipboard (PNG, with TIFF while it is not too large),
  /// encoded off the main actor, then written under the screenshot's clipboard claim.
  func copy(_ kept: LongScreenshotKept) {
    guard let source else { return }
    let cover = CaptureExport.longScreenshotCover(source, kept: kept, mosaic: mosaic)
    run(.copy) { [self] generation in
      guard
        let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept, cover: cover),
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
    let cover = CaptureExport.longScreenshotCover(source, kept: kept, mosaic: mosaic)
    run(.attach) { [self] generation in
      guard
        let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept, cover: cover)
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
