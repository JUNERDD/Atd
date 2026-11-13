import AICore
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Localized display names for save folders as Finder presents them.
enum SaveFolderDisplay {
  static func name(for url: URL) -> String {
    FileManager.default.displayName(atPath: url.path(percentEncoded: false))
  }

  static func parentName(of fileURL: URL) -> String {
    name(for: fileURL.deletingLastPathComponent())
  }
}

extension CaptureExport {
  /// Writes `image` as a full-resolution PNG with DPI metadata matching `scale` into `folder`,
  /// creating `folder` if missing and deduplicating the filename. Never downscales or falls back
  /// to JPEG.
  @concurrent
  nonisolated static func saveScreenshot(
    _ image: CGImage, scale: CGFloat, capturedAt: Date, long: Bool = false, in folder: URL
  ) async throws(ImageExportFailure) -> URL {
    let data = try encodePNG(image, scale: scale)
    let fileManager = FileManager.default
    do {
      try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw .unwritable
    }
    let baseName =
      long
      ? LongScreenshotExportRules.fileName(capturedAt: capturedAt, encoding: .png)
      : ScreenshotRules.fileName(capturedAt: capturedAt, encoding: .png)
    let uniqueName = RecordingFileNames.unique(baseName) { candidate in
      fileManager.fileExists(atPath: folder.appending(path: candidate).path(percentEncoded: false))
    }
    let destinationURL = folder.appending(path: uniqueName)
    try writePNG(data, to: destinationURL)
    return destinationURL
  }

  /// Writes `image` as a full-resolution PNG with DPI metadata matching `scale` directly to
  /// `destination`.
  @concurrent
  nonisolated static func saveScreenshotToFile(
    _ image: CGImage, scale: CGFloat, destination: URL
  ) async throws(ImageExportFailure) -> URL {
    let data = try encodePNG(image, scale: scale)
    try writePNG(data, to: destination)
    return destination
  }

  private nonisolated static func encodePNG(_ image: CGImage, scale: CGFloat)
    throws(ImageExportFailure) -> Data
  {
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, UTType.png.identifier as CFString, 1, nil)
    else { throw .unencodable }
    let dpi = 72.0 * Double(scale)
    let properties: [CFString: Any] = [
      kCGImagePropertyDPIWidth: dpi,
      kCGImagePropertyDPIHeight: dpi,
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw .unencodable }
    return data as Data
  }

  private nonisolated static func writePNG(_ data: Data, to destinationURL: URL)
    throws(ImageExportFailure)
  {
    do {
      try data.write(to: destinationURL, options: .atomic)
    } catch {
      throw .unwritable
    }
  }
}
