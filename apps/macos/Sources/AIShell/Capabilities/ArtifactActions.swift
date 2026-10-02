import AICore
import AIRelay
import AppKit

/// Artifact operations: the shell downloads the
/// bytes with its credentials into its downloads folder, quarantined, then opens, reveals or
/// copies the path. The page can upload any file and ask to open it, so only document types
/// (``ArtifactOpenPolicy``) open directly; any other type opens only after the user chooses
/// Open Anyway in a native confirmation, and Gatekeeper still checks it then.
final class ArtifactActions {
  private let services: ShellServices
  private let downloads: URL
  private let confirmations: ConfirmationPrompter

  private enum OpenChoice {
    case reveal, open, cancel
  }

  /// The shell's own downloads folder, under Application Support by bundle id.
  static func downloadsFolder() -> URL {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
    let base = support.first ?? URL(filePath: NSTemporaryDirectory())
    return base.appending(path: Bundle.main.bundleIdentifier ?? "com.junerdd.ai")
      .appending(path: "downloads")
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
