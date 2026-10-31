import AICore
import AIRelay
import AppKit
import OSLog
import UniformTypeIdentifiers

/// Attachments from the open panel, file drops on the panel's web view, pasted file URLs and
/// pasted bitmaps, and saving the page's content where the user chooses. Files are imported by path through
/// the service (`/v1/resources/import`); paths never reach the page. One drop or paste takes at
/// most ``AttachmentRules/maxPathsPerImport`` files, the page's attachment limit, and a pick of
/// more takes none.
///
/// Folders become folder refs through `/v1/folders/register`, at most ``ImportBatch/maxFolders``
/// per gesture. Every gesture that hands the app files or folders — a drop or paste on the
/// panel, the Finder service, a drop on the Dock icon, `open -a` — goes through
/// ``importItems(_:queueWhenUnavailable:)``: its items split into files and folders
/// (``ImportBatch``), both requests run, and the page gets one `resources.imported` event that
/// accounts for every item, those past the limits and those of a failed request included. The
/// gestures from outside the panel (``importOpened(_:)``) wait in the shell while the service
/// is unreachable and are imported once the control stream connects (``serviceDidConnect()``).
///
/// A file drag over the panel and the import of its drop reach the page as `files.drag`
/// (``FileDropState``), so it can show what the drop attaches and that it is being added. A drop
/// from another app that brings files without their URLs (``DroppedContent``) is taken as the
/// mini panel takes it: promised files are received first (``PromisedDrop``), and a bitmap goes
/// in like a pasted one.
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
  /// Where promised files dropped on the panel arrive, as the mini panel's do.
  private let dropFolder = MiniPanelDropFolder.forMainBundle()
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
      if source == "drop" {
        whileImporting { await self.importItems(urls, queueWhenUnavailable: false) }
      } else {
        Task { await self.importItems(urls, queueWhenUnavailable: false) }
      }
    }
    panel.onDroppedContent = { [weak self] content in self?.takeDropped(content) }
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

  /// Runs one import of a drop while the page shows the drop as importing.
  private func whileImporting(_ work: @escaping () async -> Void) {
    updateDrop { $0.beginImport() }
    Task {
      await work()
      updateDrop { $0.endImport() }
    }
  }

  /// A drop's bitmap goes in like a pasted image, and its promised files as they arrive; the page
  /// shows the drop as importing until the last of them answered, the wait for them included.
  private func takeDropped(_ content: DroppedContent) {
    switch content {
    case .image(let data):
      whileImporting { await self.importPastedImage(data) }
    case .promises(let receivers, let board):
      updateDrop { $0.beginImport() }
      PromisedDrop(
        folder: dropFolder, log: Self.log,
        deliver: { [weak self] files in
          self?.whileImporting { await self?.importItems(files, queueWhenUnavailable: false) }
        },
        importImage: { [weak self] data in
          self?.whileImporting { await self?.importPastedImage(data) }
        },
        reportFailures: { [weak self] failures in self?.report(failures) },
        finished: { [weak self] in self?.updateDrop { $0.endImport() } }
      ).receive(receivers, from: board)
    }
  }

  /// `files.pick`: the service's import of the chooser's files, each stored or refused with its
  /// reason, so every refused file can be reported; empty when cancelled. Choosing more files
  /// than one pick takes imports none and fails with the limit, as the page refuses files past
  /// its room as a group.
  func pick() async throws(BridgeError) -> ResourceImportResponse {
    guard let urls = await systemPanels.chooseAttachments(), !urls.isEmpty else { return .empty }
    guard urls.count <= AttachmentRules.maxPathsPerImport else {
      throw BridgeError(
        ShellStrings.shared.text(.filePickLimit, count: AttachmentRules.maxPathsPerImport))
    }
    return try await importPaths(urls)
  }

  /// `files.pickFolder`: the chosen folders registered as the page's refs, and each one past the
  /// first ``ImportBatch/maxFolders`` reported as `tooMany`; both lists are empty when the user
  /// cancelled.
  func pickFolders() async throws(BridgeError) -> FilesPickFolderResult {
    guard let urls = await systemPanels.chooseFolders(), !urls.isEmpty else {
      return FilesPickFolderResult(folders: [], failures: [])
    }
    let batch = ImportBatch(urls.map { ImportItem(url: $0, isDirectory: true) })
    if !batch.skipped.isEmpty {
      Self.log.info("Registered the first \(batch.folders.count) of \(urls.count) folders.")
    }
    do {
      let client = try await services.client()
      return FilesPickFolderResult(
        batch: batch, registered: try await client.registerFolders(paths: batch.folderPaths))
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

  /// One gesture's files and folders become one `resources.imported` event for the panel page
  /// (``ResourcesImportedEvent/init(batch:files:folders:)``): a request that failed, the service
  /// being down included, reports each of its items as `failed`, and the items past the limits
  /// are `tooMany`. Opened items instead wait, whole, while the service is unreachable.
  func importItems(_ urls: [URL], queueWhenUnavailable: Bool) async {
    await importBatch(
      ImportBatch(urls.map(ImportItem.init(fileURL:))), queueWhenUnavailable: queueWhenUnavailable)
  }

  private func importBatch(_ batch: ImportBatch, queueWhenUnavailable: Bool) async {
    guard !batch.isEmpty else { return }
    let files: Result<ResourceImportResponse, any Error>
    let folders: Result<FolderRegisterResponse, any Error>
    var errors: [any Error] = []
    do {
      let client = try await services.client()
      async let imported = Self.answer(batch.filePaths, empty: .empty, client.importResources)
      async let registered = Self.answer(batch.folderPaths, empty: .empty, client.registerFolders)
      (files, folders) = await (imported, registered)
      if case .failure(let error) = files { errors.append(error) }
      if case .failure(let error) = folders { errors.append(error) }
    } catch {
      (files, folders) = (.failure(error), .failure(error))
      errors = [error]
    }
    // No endpoint, or none answering: the service is down, not the request refused. A part that
    // went in meanwhile goes in again unchanged: the service reuses a file it already holds, and
    // a folder's realpath keeps its id.
    if queueWhenUnavailable, errors.contains(where: { $0 is ShellServiceError || $0 is URLError }) {
      pending.append(batch)
      Self.log.info("Holding opened items until the service is available.")
      return
    }
    for error in errors {
      Self.log.error("Files or folders were not imported: \(String(describing: error))")
    }
    if !batch.skipped.isEmpty {
      Self.log.info("Left out \(batch.skipped.count) items past the attachment and folder limits.")
    }
    panel?.send(
      .resourcesImported(
        ResourcesImportedEvent(batch: batch, files: try? files.get(), folders: try? folders.get())))
  }

  /// One request's answer, or the error it failed with; with no paths, it asks nothing.
  private nonisolated static func answer<Answer: Sendable>(
    _ paths: [String], empty: Answer, _ request: ([String]) async throws -> Answer
  ) async -> Result<Answer, any Error> {
    guard !paths.isEmpty else { return .success(empty) }
    do {
      return .success(try await request(paths))
    } catch {
      return .failure(error)
    }
  }

  /// Items no import took, reported to the page like an import's failures.
  private func report(_ failures: [ResourcesImportedEvent.Failure]) {
    panel?.send(
      .resourcesImported(ResourcesImportedEvent(resources: [], folders: [], failures: failures)))
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
      report([.init(name: PastedImageName.fileName(pastedAt: now), reason: reason)])
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
