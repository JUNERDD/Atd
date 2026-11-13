import AICore
import AppKit

/// The full-screen preview's text commands (the plan's 「长截图的全屏预览」): what the preview
/// reads from the screenshot capability (``screenshots``), the files each run reads, and the copy
/// of the segment a run changed (decision D9).
extension LongScreenshotController {
  /// What the preview's text commands use (``LongScreenshotTextServices``), each member answering
  /// as things stand when it is called.
  var textServices: LongScreenshotTextServices {
    LongScreenshotTextServices(
      commands: { [weak self] in self?.screenshots?.textCommands ?? [] },
      catalog: { [weak self] in self?.screenshots?.commandOptions() ?? CommandOptionsCatalog() },
      onPick: { [weak self] id, values in self?.screenshots?.onCommandOptionsPicked?(id, values) },
      runner: { [weak self] in self?.screenshots?.textRuns },
      files: { [weak self] kept in await self?.textFiles(kept) },
      copyImage: { [weak self] kept in await self?.copyImage(kept) },
      copyText: { [weak self] text in
        self?.arbiter.writeClipboard(text, as: .screenshot) ?? false
      })
  }

  /// The kept image as the preview shows it, and its context, for a run to read; nil when they
  /// could not be written or another long screenshot took the card's place.
  private func textFiles(_ kept: LongScreenshotKept) async -> CaptureTextRunner.Files? {
    guard let source else { return nil }
    let generation = generation
    guard let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept)
    else { return nil }
    let files: LongScreenshotFiles
    do throws(LongScreenshotFiles.Failure) {
      files = try await LongScreenshotFiles.write(image, capturedAt: source.shot.capturedAt) {
        LongScreenshotContext(
          source: source, kept: kept, pixelWidth: $0.width, pixelHeight: $0.height)
      }
    } catch {
      return nil
    }
    guard generation == self.generation else {
      files.delete()
      return nil
    }
    return CaptureTextRunner.Files(urls: files.all, delete: { files.delete() })
  }

  /// `kept` at full pixels on the clipboard, as Copy puts the whole kept range there; its size in
  /// points, or nil when it could not be copied.
  private func copyImage(_ kept: LongScreenshotKept) async -> CGSize? {
    guard let source else { return nil }
    let generation = generation
    guard
      let image = await CaptureExport.longScreenshotKept(source.shot, kept: kept),
      let clipboard = await CaptureExport.longScreenshotClipboard(image, scale: source.shot.scale),
      generation == self.generation,
      arbiter.writeClipboard(as: .screenshot, { CaptureExport.copy(clipboard, to: $0) })
    else { return nil }
    let scale = max(source.shot.scale, 0.01)
    return CGSize(width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
  }
}
