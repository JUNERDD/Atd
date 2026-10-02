import AICore
import AIRelay
import AppKit
import UniformTypeIdentifiers

/// The shell's answers to the service's desktop capability requests, which the control stream
/// (``ControlStreamClient``) receives. Reads that could take text
/// from the user's apps (selection, clipboard) answer only while the panel is visible. A thrown
/// ``CapabilityFailure`` is the message the agent sees.
final class ShellCapabilities: CapabilityHandling {
  private let services: ShellServices
  private let panelVisible: () -> Bool
  private let systemPanels: SystemPanels

  init(
    services: ShellServices, panelVisible: @escaping () -> Bool, systemPanels: SystemPanels
  ) {
    self.services = services
    self.panelVisible = panelVisible
    self.systemPanels = systemPanels
  }

  func handle(_ request: CapabilityRequest) async throws -> JSONValue {
    switch request.capability {
    case .filePick: try await pickFiles()
    case .fileSave: try await saveFile(request.input)
    case .selectionRead: try await readSelection()
    case .clipboardRead: try readClipboard()
    case .clipboardWrite: try writeClipboard(request.input)
    }
  }

  /// Attachable files the user picks, imported by path. The value's shape:
  /// `{ files: [{ resourceId, name, size, mime }] }`.
  private func pickFiles() async throws -> JSONValue {
    guard let urls = await systemPanels.chooseAttachments(), !urls.isEmpty else {
      throw CapabilityFailure("No file was selected.")
    }
    guard urls.count <= AttachmentRules.maxPathsPerImport else {
      throw CapabilityFailure("Attach at most \(AttachmentRules.maxPathsPerImport) files.")
    }
    let response = try await services.client().importResources(
      paths: urls.map { $0.path(percentEncoded: false) })
    if let failure = response.failures.first { throw CapabilityFailure(failure.message) }
    let files: [JSONValue] = response.imported.map { imported in
      .object([
        "resourceId": .string(imported.resource.id), "name": .string(imported.resource.name),
        "size": .number(Double(imported.resource.size)), "mime": .string(imported.resource.mime),
      ])
    }
    return .object(["files": .array(files)])
  }

  /// The agent's bytes where the user chooses, quarantined like any download.
  private func saveFile(_ input: JSONValue) async throws -> JSONValue {
    let file: CapabilityInputs.FileSave
    switch CapabilityInputs.fileSave(input) {
    case .success(let value): file = value
    case .failure(let error): throw CapabilityFailure(error.message)
    }
    guard let url = await systemPanels.chooseSaveLocation(suggestedName: file.suggestedName)
    else { throw CapabilityFailure("The save was cancelled.") }
    do {
      try DownloadQuarantine.app.write(file.bytes, to: url)
    } catch {
      throw CapabilityFailure("The file could not be saved.")
    }
    return CapabilityInputs.fileSaved(name: url.lastPathComponent, size: file.bytes.count)
  }

  /// A live read, not the summon stash.
  private func readSelection() async throws -> JSONValue {
    let visible = panelVisible()
    let trusted = SelectionReader.isTrusted
    let text =
      visible && trusted
      ? await SelectionReader.readBounded(
        frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier) : nil
    return try Self.value(
      TextCapture.liveSelection(text, at: .now, panelVisible: visible, readable: trusted))
  }

  private func readClipboard() throws -> JSONValue {
    let visible = panelVisible()
    let text = visible ? NSPasteboard.general.string(forType: .string) : nil
    return try Self.value(TextCapture.clipboard(text, at: .now, panelVisible: visible))
  }

  private func writeClipboard(_ input: JSONValue) throws -> JSONValue {
    switch CapabilityInputs.clipboardWrite(input) {
    case .success(let text):
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      return .object(["ok": .bool(true)])
    case .failure(let error):
      throw CapabilityFailure(error.message)
    }
  }

  private static func value(_ capture: Result<CapturedText, CaptureFailure>) throws -> JSONValue {
    switch capture {
    case .success(let captured):
      .object(["text": .string(captured.text), "capturedAt": .string(captured.capturedAt)])
    case .failure(let failure):
      throw CapabilityFailure(failure.message)
    }
  }
}

/// A capability request the shell refuses; the message goes to the agent as is.
struct CapabilityFailure: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// Open and save panels. While one is open the panel floats no higher than normal windows
/// (so the system panel is never hidden behind it) and summons are ignored.
final class SystemPanels {
  private(set) var isOpen = false
  private let lowerPanel: () -> NSWindow.Level
  private let restorePanel: (NSWindow.Level) -> Void

  init(
    lowerPanel: @escaping () -> NSWindow.Level, restorePanel: @escaping (NSWindow.Level) -> Void
  ) {
    self.lowerPanel = lowerPanel
    self.restorePanel = restorePanel
  }

  /// Attachable files (text and images); nil when cancelled or another system panel is open.
  func chooseAttachments() async -> [URL]? {
    let panel = NSOpenPanel()
    panel.message = ShellStrings.shared.text(.filePickTitle)
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = true
    panel.allowedContentTypes = AttachmentRules.extensions.compactMap {
      UTType(filenameExtension: $0)
    }
    return await run(panel) ? panel.urls : nil
  }

  /// Where to save under `suggestedName`; `contentType` restricts the panel to that type. Nil
  /// when cancelled or another system panel is open.
  func chooseSaveLocation(suggestedName: String, contentType: UTType? = nil) async -> URL? {
    let panel = NSSavePanel()
    panel.title = ShellStrings.shared.text(.fileSaveTitle)
    if let contentType { panel.allowedContentTypes = [contentType] }
    panel.nameFieldStringValue = suggestedName
    return await run(panel) ? panel.url : nil
  }

  private func run(_ panel: NSSavePanel) async -> Bool {
    guard !isOpen else { return false }
    isOpen = true
    let level = lowerPanel()
    defer {
      isOpen = false
      restorePanel(level)
    }
    NSApp.activate()
    return await panel.begin() == .OK
  }
}
