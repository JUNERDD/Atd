import AICore
import AIRelay
import AppKit
import OSLog
import UniformTypeIdentifiers

/// Attachments from the open panel, file drops on the panel's web view, pasted file URLs and
/// pasted bitmaps, and saving the page's content where the user chooses. Files are imported by path through
/// the service (`/v1/resources/import`); paths never reach the page. One pick, drop or paste
/// takes at most ``AttachmentRules/maxPathsPerImport`` files, the page's attachment limit.
///
/// Folders become folder refs through `/v1/folders/register`, at most ``ImportBatch/maxFolders``
/// per gesture. Every gesture that hands the app files or folders — a drop or paste on the
/// panel, the Finder service, a drop on the Dock icon, `open -a` — goes through
/// ``importItems(_:queueWhenUnavailable:)``: its items split into files and folders
/// (``ImportBatch``), both requests run, and the page gets one `resources.imported` event. The
/// gestures from outside the panel (``importOpened(_:)``) wait in the shell while the service
/// is unreachable and are imported once the control stream connects (``serviceDidConnect()``).
///
/// A file drag over the panel and the import of its drop reach the page as `files.drag`
/// (``FileDropState``), so it can show what the drop attaches and that it is being added.
///
/// A paste with a bitmap but neither file URL nor text (a screenshot copied to the clipboard)
/// is stored as `Pasted image <date>.png` in a temporary folder and imported like a file;
/// ``PastedImageExport`` scales and encodes it. Screenshots arrive through ``ScreenshotTaker``,
/// which imports its capture through ``importPaths(_:)``.
final class AttachmentImporter {
  private let services: ShellServices
  private weak var panel: WebViewHost?
  private let systemPanels: SystemPanels
  private var drop = FileDropState()
  /// Opened items waiting for the service.
  private var pending: [ImportBatch] = []
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "attachments")

  init(services: ShellServices, panel: WebViewHost, systemPanels: SystemPanels) {
    self.services = services
    self.panel = panel
    self.systemPanels = systemPanels
    // The panel's web view is the only one that takes file drops and turns pastes into
    // attachments.
    panel.onFiles = { [weak self] urls, source in
      guard let self else { return }
      if source == "drop" { updateDrop { $0.beginImport() } }
      Task {
        await self.importItems(urls, queueWhenUnavailable: false)
        if source == "drop" { self.updateDrop { $0.endImport() } }
      }
    }
    panel.onFileDrag = { [weak self] summary in self?.updateDrop { $0.setDrag(summary) } }
    panel.onPastedImage = { [weak self] data in
      guard let self else { return }
      Task { await self.importPastedImage(data) }
    }
  }

  /// Applies a drop change and sends the page the phase when it changed.
  private func updateDrop(_ change: (inout FileDropState) -> Void) {
    let before = drop.event
    change(&drop)
    if drop.event != before { panel?.setState(.filesDrag(drop.event)) }
  }

  /// `files.pick`: the chooser's files as the page's refs; none when cancelled. A pick whose
  /// every file was refused fails with the first reason.
  func pick() async throws(BridgeError) -> [FileRef] {
    guard let urls = await systemPanels.chooseAttachments(), !urls.isEmpty else { return [] }
    let response = try await importPaths(urls)
    if response.imported.isEmpty, let failure = response.failures.first {
      throw BridgeError(failure.message)
    }
    return response.imported.map { FileRef($0.resource) }
  }

  /// `files.pickFolder`: the chosen folders registered as the page's refs; both lists are
  /// empty when the user cancelled.
  func pickFolders() async throws(BridgeError) -> FilesPickFolderResult {
    guard let urls = await systemPanels.chooseFolders(), !urls.isEmpty else {
      return FilesPickFolderResult(folders: [], failures: [])
    }
    let batch = ImportBatch(urls.map { ImportItem(url: $0, isDirectory: true) })
    if batch.skipped > 0 {
      Self.log.info("Registered the first \(batch.folders.count) of \(urls.count) folders.")
    }
    do {
      let client = try await services.client()
      return FilesPickFolderResult(try await client.registerFolders(paths: batch.folderPaths))
    } catch {
      throw BridgeError(ShellBridge.message(error, "The folders could not be added."))
    }
  }

  /// Files and folders from outside the panel: the Finder service, the Dock icon, `open -a`.
  func importOpened(_ urls: [URL]) {
    Task { await importItems(urls, queueWhenUnavailable: true) }
  }

  /// The control stream connected: opened items that waited for the service go in now.
  func serviceDidConnect() {
    let batches = pending
    pending = []
    Task {
      for batch in batches { await importBatch(batch, queueWhenUnavailable: true) }
    }
  }

  /// One gesture's files and folders become one `resources.imported` event for the panel page.
  /// With the service unreachable, a drop or paste sends nothing (the page already shows the
  /// service as down) while opened items wait for it.
  func importItems(_ urls: [URL], queueWhenUnavailable: Bool) async {
    await importBatch(
      ImportBatch(urls.map(ImportItem.init(fileURL:))), queueWhenUnavailable: queueWhenUnavailable)
  }

  private func importBatch(_ batch: ImportBatch, queueWhenUnavailable: Bool) async {
    guard !batch.isEmpty else { return }
    if batch.skipped > 0 {
      Self.log.info("Left out \(batch.skipped) items past the attachment and folder limits.")
    }
    do {
      let client = try await services.client()
      async let files =
        batch.files.isEmpty ? .empty : client.importResources(paths: batch.filePaths)
      async let folders =
        batch.folders.isEmpty ? .empty : client.registerFolders(paths: batch.folderPaths)
      let event = ResourcesImportedEvent(files: try await files, folders: try await folders)
      panel?.send(.resourcesImported(event))
    } catch {
      // No endpoint, or none answering: the service is down, not the request refused.
      if queueWhenUnavailable, error is ShellServiceError || error is URLError {
        pending.append(batch)
        Self.log.info("Holding opened items until the service is available.")
      } else {
        Self.log.error("Files or folders were not imported: \(String(describing: error))")
      }
    }
  }

  /// A pasted bitmap as an image attachment, announced to the page like any import. A bitmap
  /// that cannot be stored is reported as a failure under its would-be name, since WebKit no
  /// longer pastes it. The temporary file is gone once the service has read it.
  func importPastedImage(_ data: Data) async {
    let now = Date.now
    let folder = URL.temporaryDirectory.appending(path: "pasted-image-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let file = try await PastedImageExport.store(data, pastedAt: now, in: folder)
      await importItems([file], queueWhenUnavailable: false)
    } catch {
      Self.log.error("A pasted image was not attached: \(String(describing: error))")
      let reason: ResourcesImportedEvent.Failure.Reason =
        (error as? PastedImageExport.Failure) == .tooLarge ? .tooLarge : .unreadable
      panel?.send(
        .resourcesImported(
          ResourcesImportedEvent(
            resources: [], folders: [],
            failures: [.init(name: PastedImageName.fileName(pastedAt: now), reason: reason)])))
    }
  }

  /// `files.save`: the page's content (``SavedFile``) where the user chooses, quarantined like
  /// any download. False when the user cancelled or another system panel is open.
  func save(_ params: FilesSaveParams) async throws(BridgeError) -> Bool {
    let file: SavedFile
    switch SavedFile.validate(params) {
    case .success(let value): file = value
    case .failure: throw BridgeError(ShellStrings.shared.text(.fileSaveInvalidImage))
    }
    guard
      let url = await systemPanels.chooseSaveLocation(
        suggestedName: file.suggestedName, contentType: file.isPNG ? .png : nil)
    else { return false }
    do {
      try DownloadQuarantine.app.write(file.bytes, to: url)
      return true
    } catch {
      throw BridgeError(ShellStrings.shared.text(.fileSaveFailed))
    }
  }

  /// The service's import of local files, at most ``AttachmentRules/maxPathsPerImport``.
  func importPaths(_ urls: [URL]) async throws(BridgeError) -> ResourceImportResponse {
    let paths = urls.filter(\.isFileURL).prefix(AttachmentRules.maxPathsPerImport).map {
      $0.standardizedFileURL.path(percentEncoded: false)
    }
    guard !paths.isEmpty else { return ResourceImportResponse(imported: [], failures: []) }
    if urls.count > paths.count {
      Self.log.info("Imported the first \(paths.count) of \(urls.count) files.")
    }
    do {
      return try await services.client().importResources(paths: Array(paths))
    } catch {
      throw BridgeError(ShellBridge.message(error, "The files could not be attached."))
    }
  }
}

extension ImportItem {
  /// `url` as the import sees it: a directory (after following links) is a folder; anything
  /// else, unreadable paths included, is a file whose import then reports why it failed.
  init(fileURL url: URL) {
    let values = try? url.resolvingSymlinksInPath().resourceValues(forKeys: [.isDirectoryKey])
    self.init(url: url, isDirectory: values?.isDirectory ?? false)
  }
}
