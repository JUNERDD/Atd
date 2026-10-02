import AICore
import AIRelay
import AppKit
import OSLog

/// Attachments from the open panel, file drops on the panel's web view and pasted file URLs,
/// and saving a service resource where the user chooses. Files are imported by path through
/// the service (`/v1/resources/import`); paths never reach the page. One pick, drop or paste
/// takes at most ``AttachmentRules/maxPathsPerImport`` files, the page's attachment limit.
///
/// Pasted images are not attachments: the service only reads the text formats of
/// `ATTACHABLE_EXTENSIONS`, so a bitmap-only paste stays with WebKit's own paste.
@MainActor
final class AttachmentImporter {
  private let services: ShellServices
  private weak var panel: WebViewHost?
  private let systemPanels: SystemPanels
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "attachments")

  init(services: ShellServices, panel: WebViewHost, systemPanels: SystemPanels) {
    self.services = services
    self.panel = panel
    self.systemPanels = systemPanels
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

  /// Dropped or pasted files become one `resources.imported` event for the panel page. With
  /// the service unreachable nothing is sent: the page already shows the service as down.
  func importFiles(_ urls: [URL]) async {
    do {
      let response = try await importPaths(urls)
      guard !response.imported.isEmpty || !response.failures.isEmpty else { return }
      panel?.send(.resourcesImported(ResourcesImportedEvent(response)))
    } catch {
      Self.log.error("Dropped or pasted files were not imported: \(error.message)")
    }
  }

  /// `files.save`: the save panel, then the resource's bytes from the service, quarantined.
  func save(resourceId: String, name: String) async throws(BridgeError) -> Bool {
    let suggested = AttachmentRules.basename(name)
    guard
      let url = await systemPanels.chooseSaveLocation(
        suggestedName: suggested.isEmpty ? ArtifactFileName.fallback : suggested)
    else { return false }
    do {
      let resource = try await services.client().resource(id: resourceId)
      try DownloadQuarantine.app.write(resource.bytes, to: url)
      return true
    } catch {
      throw BridgeError(ShellBridge.message(error, "The file could not be saved."))
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

/// Artifact operations: the shell downloads the
/// bytes with its credentials into its downloads folder, quarantined, then opens, reveals or
/// copies the path. The page can upload any file and ask to open it, so only document types
/// (``ArtifactOpenPolicy``) open directly; any other type opens only after the user chooses
/// Open Anyway in a native confirmation, and Gatekeeper still checks it then.
@MainActor
final class ArtifactActions {
  private let services: ShellServices
  private let downloads: URL
  private let confirmations: ConfirmationPrompter

  private enum OpenChoice {
    case reveal, open, cancel
  }

  init(services: ShellServices, downloads: URL, confirmations: ConfirmationPrompter) {
    self.services = services
    self.downloads = downloads
    self.confirmations = confirmations
  }

  /// The downloaded file as the page's `FileRef`, whatever the user chose for a confirmed open.
  func perform(artifactId: String, operation: ArtifactParams.Operation) async throws(BridgeError)
    -> FileRef
  {
    let downloaded: DownloadedArtifact
    do {
      downloaded = try await services.client().downloadArtifact(id: artifactId, into: downloads)
    } catch {
      throw BridgeError(ShellBridge.message(error, "The artifact could not be downloaded."))
    }
    switch operation {
    case .open:
      try await open(downloaded)
    case .reveal:
      NSWorkspace.shared.activateFileViewerSelecting([downloaded.fileURL])
    case .copyPath:
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(
        downloaded.fileURL.path(percentEncoded: false), forType: .string)
    }
    return FileRef(
      id: artifactId, name: downloaded.name, size: downloaded.size, type: downloaded.mime)
  }

  /// Classifies the file by the content type Launch Services will open it as. Cancel, or no
  /// answer because another confirmation is open, leaves the file downloaded and unopened.
  private func open(_ downloaded: DownloadedArtifact) async throws(BridgeError) {
    let url = downloaded.fileURL
    let type = try? url.resourceValues(forKeys: [.contentTypeKey]).contentType
    let decision = ArtifactOpenPolicy.decision(
      typeIdentifier: type?.identifier, conformsTo: type?.supertypes.map(\.identifier) ?? [])
    if decision == .askFirst {
      switch await confirmations.ask(Self.prompt(name: downloaded.name)) ?? .cancel {
      case .open: break
      case .reveal:
        NSWorkspace.shared.activateFileViewerSelecting([url])
        return
      case .cancel: return
      }
    }
    guard NSWorkspace.shared.open(url) else {
      throw BridgeError("The artifact could not be opened.")
    }
  }

  /// Show in Finder is the default answer, Cancel the Escape one.
  private static func prompt(name: String) -> ConfirmationPrompt<OpenChoice> {
    let strings = ShellStrings.shared
    return ConfirmationPrompt(
      title: strings.text(.artifactOpenTitle, ArtifactOpenPolicy.displayName(name)),
      message: strings.text(.artifactOpenMessage),
      buttons: [
        .init(title: strings.text(.artifactOpenShowInFinder), choice: .reveal, isDefault: true),
        .init(title: strings.text(.artifactOpenAnyway), choice: .open, isDestructive: true),
        .init(title: strings.text(.cancel), choice: .cancel, isCancel: true),
      ])
  }
}
