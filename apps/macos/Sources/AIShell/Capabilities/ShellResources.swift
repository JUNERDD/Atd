import AICore
import AppKit

/// Attachments from the open panel, file drops on the panel's web view and pasted file URLs.
/// Each set is imported by path through the service (`/v1/resources/import`, at most ten paths
/// per call) and the result goes to the panel page as one `attachments.imported` event; paths
/// never reach the page.
///
/// Pasted images are not attachments: the service only reads the text formats of
/// `ATTACHABLE_EXTENSIONS`, so a bitmap-only paste stays with WebKit's own paste.
@MainActor
final class AttachmentImporter {
  private let resources: any ResourceImporting
  private let sink: any ShellEventSending
  private let systemPanels: SystemPanels

  init(resources: any ResourceImporting, sink: any ShellEventSending, systemPanels: SystemPanels) {
    self.resources = resources
    self.sink = sink
    self.systemPanels = systemPanels
  }

  /// Opens the chooser; a cancelled chooser sends nothing.
  func pick() async {
    guard let urls = await systemPanels.chooseAttachments(), !urls.isEmpty else { return }
    await importFiles(urls, source: "pick")
  }

  /// `source` is `pick`, `drop` or `paste`.
  func importFiles(_ urls: [URL], source: String) async {
    let paths = urls.filter(\.isFileURL).map { $0.standardizedFileURL.path(percentEncoded: false) }
    guard !paths.isEmpty else { return }
    var payload: [String: JSONValue] = ["source": .string(source)]
    do {
      var responses: [ResourceImportResponse] = []
      for batch in AttachmentRules.importBatches(paths) {
        responses.append(try await resources.importResources(paths: batch))
      }
      let result = AttachmentImportResult(AttachmentRules.merge(responses))
      if case .object(let members) = try JSONValue(encoding: result) {
        payload.merge(members) { current, _ in current }
      }
    } catch {
      payload["error"] = .string(
        ShellCapabilities.message(error, "The files could not be attached."))
    }
    sink.send(
      ShellEvent(name: ShellEventName.attachmentsImported, payload: .object(payload)), to: .panel)
  }
}

/// Artifact operations (apps/desktop/electron/agent/artifacts.ts): the relay downloads the
/// bytes with the shell's credentials, the shell writes them to its downloads folder, then
/// opens, reveals or copies the path. Opening keeps today's semantics, which run whatever the
/// agent produced (an `.app` or `.command` too); restricting that is a separate decision.
@MainActor
final class ArtifactActions {
  private let artifacts: any ArtifactDownloading
  private let downloads: URL

  init(artifacts: any ArtifactDownloading, downloads: URL) {
    self.artifacts = artifacts
    self.downloads = downloads
  }

  /// The downloaded file as the page's `FileRef`: `{ id, name, size, type }`.
  func perform(artifactId: String, operation: ArtifactOperation) async throws(BridgeError)
    -> JSONValue
  {
    let downloaded: DownloadedArtifact
    do {
      downloaded = try await artifacts.downloadArtifact(id: artifactId)
      try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
    } catch {
      throw BridgeError(ShellCapabilities.message(error, "The artifact could not be downloaded."))
    }
    let target = downloads.appending(
      path: ArtifactFiles.fileName(artifactId: artifactId, name: downloaded.name),
      directoryHint: .notDirectory)
    do {
      try downloaded.bytes.write(to: target, options: .atomic)
    } catch {
      throw BridgeError("The artifact could not be saved.")
    }
    switch operation {
    case .open:
      guard NSWorkspace.shared.open(target) else {
        throw BridgeError("The artifact could not be opened.")
      }
    case .reveal, .locate:
      NSWorkspace.shared.activateFileViewerSelecting([target])
    case .copy:
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(target.path(percentEncoded: false), forType: .string)
    case .attach:
      break
    }
    return .object([
      "id": .string(artifactId), "name": .string(downloaded.name),
      "size": .number(Double(downloaded.bytes.count)), "type": .string(downloaded.mime),
    ])
  }
}
