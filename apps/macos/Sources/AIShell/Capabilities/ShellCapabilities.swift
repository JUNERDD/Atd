import AICore
import AppKit
import UniformTypeIdentifiers

/// The five desktop capabilities the service may ask the shell for. The relay's control stream
/// decodes `capability.request`, calls ``handle(_:)`` and sends the result; integration adapts
/// its own protocol to this one.
@MainActor
public protocol CapabilityHandling: AnyObject, Sendable {
  func pickFiles(_ request: CapabilityRequest) async -> CapabilityResult
  func saveFile(_ request: CapabilityRequest) async -> CapabilityResult
  func readSelection(_ request: CapabilityRequest) async -> CapabilityResult
  func readClipboard(_ request: CapabilityRequest) async -> CapabilityResult
  func writeClipboard(_ request: CapabilityRequest) async -> CapabilityResult
}

extension CapabilityHandling {
  public func handle(_ request: CapabilityRequest) async -> CapabilityResult {
    switch request.capability {
    case .filePick: await pickFiles(request)
    case .fileSave: await saveFile(request)
    case .selectionRead: await readSelection(request)
    case .clipboardRead: await readClipboard(request)
    case .clipboardWrite: await writeClipboard(request)
    }
  }
}

/// The shell's capability handlers, with the semantics of
/// apps/desktop/electron/service/capabilities.ts and file-save.ts. Reads that could take text
/// from the user's apps (selection, clipboard) answer only while the panel is visible.
@MainActor
final class ShellCapabilities: CapabilityHandling {
  private let resources: any ResourceImporting
  private let panelVisible: () -> Bool
  private let systemPanels: SystemPanels

  init(
    resources: any ResourceImporting, panelVisible: @escaping () -> Bool,
    systemPanels: SystemPanels
  ) {
    self.resources = resources
    self.panelVisible = panelVisible
    self.systemPanels = systemPanels
  }

  /// Text files the user picks, imported by path. The value keeps the Electron shape:
  /// `{ files: [{ resourceId, name, size, mime }] }`.
  func pickFiles(_ request: CapabilityRequest) async -> CapabilityResult {
    guard let urls = await systemPanels.chooseAttachments(), !urls.isEmpty else {
      return .failure(request, error: "No file was selected.")
    }
    guard urls.count <= AttachmentRules.maxPathsPerImport else {
      return .failure(request, error: "Attach at most \(AttachmentRules.maxPathsPerImport) files.")
    }
    do {
      let response = try await resources.importResources(
        paths: urls.map { $0.path(percentEncoded: false) })
      if let failure = response.failures.first {
        return .failure(request, error: failure.message)
      }
      let files: [JSONValue] = response.imported.map { imported in
        .object([
          "resourceId": .string(imported.resource.id), "name": .string(imported.resource.name),
          "size": .number(Double(imported.resource.size)), "mime": .string(imported.resource.mime),
        ])
      }
      return .success(request, value: .object(["files": .array(files)]))
    } catch {
      return .failure(request, error: Self.message(error, "The file picker could not complete."))
    }
  }

  func saveFile(_ request: CapabilityRequest) async -> CapabilityResult {
    let input: CapabilityInputs.FileSave
    switch CapabilityInputs.fileSave(request.input) {
    case .success(let value): input = value
    case .failure(let error): return .failure(request, error: error.message)
    }
    guard let url = await systemPanels.chooseSaveLocation(suggestedName: input.suggestedName)
    else { return .failure(request, error: "The save was cancelled.") }
    do {
      try input.bytes.write(to: url, options: .atomic)
      return .success(
        request,
        value: CapabilityInputs.fileSaved(name: url.lastPathComponent, size: input.bytes.count))
    } catch {
      return .failure(request, error: "The file could not be saved.")
    }
  }

  /// A live read, not the summon stash.
  func readSelection(_ request: CapabilityRequest) async -> CapabilityResult {
    let visible = panelVisible()
    let trusted = SelectionReader.isTrusted
    let text =
      visible && trusted
      ? await SelectionReader.readBounded(
        frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier) : nil
    return Self.result(
      request, TextCapture.liveSelection(text, at: .now, panelVisible: visible, readable: trusted))
  }

  func readClipboard(_ request: CapabilityRequest) async -> CapabilityResult {
    let visible = panelVisible()
    let text = visible ? NSPasteboard.general.string(forType: .string) : nil
    return Self.result(request, TextCapture.clipboard(text, at: .now, panelVisible: visible))
  }

  func writeClipboard(_ request: CapabilityRequest) async -> CapabilityResult {
    switch CapabilityInputs.clipboardWrite(request.input) {
    case .success(let text):
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      return .success(request, value: .object(["ok": .bool(true)]))
    case .failure(let error):
      return .failure(request, error: error.message)
    }
  }

  private static func result(
    _ request: CapabilityRequest, _ capture: Result<CapturedText, CaptureFailure>
  ) -> CapabilityResult {
    switch capture {
    case .success(let captured):
      .success(
        request,
        value: .object(["text": .string(captured.text), "capturedAt": .string(captured.capturedAt)])
      )
    case .failure(let failure):
      .failure(request, error: failure.message)
    }
  }

  static func message(_ error: any Error, _ fallback: String) -> String {
    (error as? LocalizedError)?.errorDescription ?? fallback
  }
}

/// Open and save panels. While one is open the panel floats no higher than normal windows
/// (so the system panel is never hidden behind it) and summons are ignored, as in Electron's
/// `withFileDialog`.
@MainActor
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

  /// Attachable text files; nil when cancelled or another system panel is open.
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

  func chooseSaveLocation(suggestedName: String) async -> URL? {
    let panel = NSSavePanel()
    panel.title = ShellStrings.shared.text(.fileSaveTitle)
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
