import AICore
import AppKit

/// Turns confirmed captures into attachments and keeps what reopening them needs (decisions
/// F1, F2). A capture is imported as its image plus, when anything is known about the screen
/// around it, a `… context.md` attachment in the same import call. The raw pixels, scale and
/// annotations of the last ``capacity`` imports stay in memory for this app run, keyed by the
/// image's resource id; any other image is downloaded from the service to be edited.
final class CaptureLibrary {
  /// Imported files: the image and its screen context, when one was attached.
  struct Imported {
    let file: FileRef
    let context: FileRef?
  }

  static let capacity = 10

  private let attachments: AttachmentImporter
  private let download: @MainActor (String) async throws -> Data
  private var archive = RecentValues<ReopenBase>(capacity: capacity)

  /// `download` reads a resource's bytes through the service client.
  init(
    attachments: AttachmentImporter, download: @escaping @MainActor (String) async throws -> Data
  ) {
    self.attachments = attachments
    self.download = download
  }

  /// Imports `capture`, with a screen-context file when `snapshot` is given (a new capture;
  /// an edited one has none), and archives it under the image's resource id. Text recognition
  /// runs while the image is encoded; a context that cannot be written or imported is left
  /// out without failing the capture.
  func importCapture(
    _ capture: CaptureConfirmation, capturedAt: Date, snapshot: WindowSnapshot?
  ) async throws(BridgeError) -> Imported {
    let folder = URL.temporaryDirectory.appending(path: "screenshot-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw BridgeError("The screenshot could not be prepared.")
    }
    let raw = capture.raw
    async let recognized = snapshot == nil ? [] : ScreenText.lines(in: raw)
    let image = try await CaptureExport.store(capture.image, capturedAt: capturedAt, in: folder)
    var files = [image]
    if let snapshot {
      let centre = CaptureCoordinates.quartzPoint(
        CGPoint(x: capture.selection.midX, y: capture.selection.midY),
        display: capture.displayFrame)
      let window = snapshot.describe(at: centre)
      let context = ScreenContext(
        app: window.app, window: window.window, element: capture.element.map(Self.element),
        lines: await recognized)
      if let markdown = context.markdown,
        let file = await Self.write(
          markdown,
          to: folder.appending(path: ScreenshotRules.contextFileName(capturedAt: capturedAt)))
      {
        files.append(file)
      }
    }
    let response = try await attachments.importPaths(files)
    // Both lists keep the request's paths; a file is found by its name, which is unique here.
    func named(_ file: URL) -> (String) -> Bool {
      { AttachmentRules.basename($0) == file.lastPathComponent }
    }
    func imported(_ file: URL) -> ResourceRef? {
      response.imported.first { named(file)($0.path) }?.resource
    }
    guard let resource = imported(image) else {
      throw BridgeError(
        response.failures.first { named(image)($0.path) }?.message
          ?? "The screenshot could not be attached.")
    }
    archive.insert(
      ReopenBase(image: capture.raw, scale: capture.pixelScale, document: capture.document),
      for: resource.id)
    return Imported(
      file: FileRef(resource), context: files.dropFirst().first.flatMap(imported).map(FileRef.init))
  }

  /// What `screenshot.edit` opens for `resourceId`: the archived capture when it can keep its
  /// size on the screen under the pointer (its annotations are in points), otherwise the
  /// stored image itself — annotations then already drawn in.
  func base(for resourceId: String) async throws(BridgeError) -> ReopenBase {
    let screen =
      NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }
      ?? NSScreen.main
    if let archived = archive.value(for: resourceId), let screen,
      archived.opens(onScreen: screen.frame.size, scale: screen.backingScaleFactor)
    {
      return archived
    }
    let data: Data
    do {
      data = try await download(resourceId)
    } catch {
      throw BridgeError(ShellBridge.message(error, "The image could not be downloaded."))
    }
    guard let decoded = await ReopenBase.decode(data) else {
      throw BridgeError("Only images can be edited.")
    }
    return decoded
  }

  private static func element(_ description: ElementDescription) -> ScreenContext.Element {
    ScreenContext.Element(
      role: description.role, title: description.title, value: description.value,
      help: description.help)
  }

  /// Writes the context file off the main actor; nil when it could not be written.
  @concurrent
  private nonisolated static func write(_ markdown: String, to file: URL) async -> URL? {
    do {
      try Data(markdown.utf8).write(to: file)
      return file
    } catch {
      return nil
    }
  }
}
