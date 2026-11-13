import AICore
import CoreGraphics
import Foundation

/// The files a long screenshot is attached or asked about as (decision D8): the kept image and,
/// when anything is known about it, its context, in a folder of their own in the temporary
/// directory. An import copies them, so the folder goes once the import answered
/// (``delete()``), as a screenshot's does (``CaptureLibrary``).
nonisolated struct LongScreenshotFiles: Sendable {
  /// Why the files could not be written: the words the card's button says it with.
  struct Failure: Error {
    let reason: LongScreenshotResultStringKey
  }

  let folder: URL
  let image: URL
  let context: URL?

  /// The image first, then its context, as a screenshot's are imported.
  var all: [URL] { [image] + (context.map { [$0] } ?? []) }

  /// Writes `image` (a kept image) under the names of a long screenshot taken at `capturedAt`,
  /// then the context `describe` gives for the file's pixel size. A context that cannot be
  /// written is left out without failing the image.
  @concurrent
  static func write(
    _ image: CGImage, capturedAt: Date,
    describe: @Sendable (ScreenshotPixelSize) -> LongScreenshotContext
  ) async throws(Failure) -> LongScreenshotFiles {
    let folder = URL.temporaryDirectory.appending(path: "long-screenshot-\(UUID().uuidString)")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw Failure(reason: .exportFailed)
    }
    let stored: (file: URL, size: ScreenshotPixelSize)
    do throws(ImageExportFailure) {
      stored = try await CaptureExport.storeLongScreenshot(
        image, capturedAt: capturedAt, in: folder)
    } catch .tooLarge {
      try? FileManager.default.removeItem(at: folder)
      throw Failure(reason: .tooLarge)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      throw Failure(reason: .exportFailed)
    }
    var context: URL?
    if let markdown = describe(stored.size).markdown {
      let file = folder.appending(
        path: LongScreenshotExportRules.contextFileName(capturedAt: capturedAt))
      context = (try? Data(markdown.utf8).write(to: file)).map { file }
    }
    return LongScreenshotFiles(folder: folder, image: stored.file, context: context)
  }

  /// Removes the folder; one already gone is fine.
  func delete() {
    try? FileManager.default.removeItem(at: folder)
  }
}
