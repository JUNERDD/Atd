import AICore
import AppKit
import OSLog
import UniformTypeIdentifiers
import WebKit

/// The page's end of the user app bridge:
/// `await window.webkit.messageHandlers.atdApp.postMessage({ type, method, params })`.
/// A message is heard only from the main frame of `ai-userapp://<appId>` (port 0) where `appId`
/// is the app of the window whose current web view sent it; everything else is refused before
/// any parsing. It is decoded against the generated contract (``UserAppMessage``) and handed to
/// ``UserAppBridge``, never to the renderer's ``ShellBridge``. WebKit pairs the reply with the
/// message: a call resolves with its result, a post with null, and either rejects with a message.
final class UserAppMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
  private let bridge: UserAppBridge
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(bridge: UserAppBridge) {
    self.bridge = bridge
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    let origin = message.frameInfo.securityOrigin
    guard let host = bridge.windows?.host(for: message.webView),
      UserAppOrigin.isTrustedSender(
        scheme: origin.protocol, host: origin.host, port: origin.port,
        isMainFrame: message.frameInfo.isMainFrame, appId: host.appId)
    else {
      Self.log.error("Refused an app bridge message from an untrusted sender.")
      return replyHandler(nil, "The app bridge refused this sender.")
    }
    let decoded: UserAppMessage
    do {
      guard JSONSerialization.isValidJSONObject(message.body) else {
        throw BridgeError("The message is not a JSON object.")
      }
      let data = try JSONSerialization.data(withJSONObject: message.body)
      decoded = try JSONDecoder().decode(UserAppMessage.self, from: data)
    } catch {
      Self.log.error(
        "Refused an app bridge message: \(String(describing: error), privacy: .public)")
      return replyHandler(nil, "The app bridge refused the message: invalid message.")
    }
    Task {
      do throws(BridgeError) {
        replyHandler(try await bridge.receive(decoded, from: host), nil)
      } catch {
        replyHandler(nil, String(error.message.prefix(2000)))
      }
    }
  }
}

/// The one dispatcher of the user app contract (`user-app-contract.ts`). It acts only for the
/// app it was told the message came from, and every capability it grants is one the user sees:
/// links open after a confirmation, files only through the open and save panels.
final class UserAppBridge {
  static let messageHandler = UserAppBridgeContract.messageHandler

  weak var windows: UserAppWindows?
  private let services: ShellServices
  private let confirmations: ConfirmationPrompter
  /// The shared open and save panels (``SystemPanels``); set by the shell.
  var systemPanels: SystemPanels?
  /// True while a screenshot capture runs: panels would open beneath its overlays.
  var isBusy: () -> Bool = { false }
  private var diagnostics: [String: UserAppDiagnosticBuffer] = [:]
  private var flushing: Set<String> = []
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(services: ShellServices, windows: UserAppWindows, confirmations: ConfirmationPrompter) {
    self.services = services
    self.windows = windows
    self.confirmations = confirmations
  }

  /// The reply value: the call's result as a JSON object, or `NSNull` for a post.
  func receive(_ message: UserAppMessage, from host: UserAppHost) async throws(BridgeError)
    -> Any
  {
    switch message {
    case .post(.appReady):
      host.pageDidBecomeReady()
      return NSNull()
    case .post(.appError(let report)):
      record(report, from: host)
      return NSNull()
    case .post(.windowDragRegions(let params)):
      host.setDragRegions(params.rects)
      return NSNull()
    case .call(.clipboardWrite(let params)):
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(params.text, forType: .string)
      return try Self.encode(UserAppClipboardWriteResult())
    case .call(.linkOpen(let params)):
      guard let url = ExternalLink.openable(params.url) else {
        throw BridgeError("Only web links can be opened.")
      }
      await windows?.openExternalLink(url, from: host)
      return try Self.encode(UserAppLinkOpenResult())
    case .call(.filesPick(let params)):
      return try Self.encode(UserAppFilesPickResult(files: try await pick(params, for: host)))
    case .call(.filesSave(let params)):
      return try Self.encode(UserAppFilesSaveResult(saved: try await save(params)))
    }
  }

  // MARK: Diagnostics

  /// Buffers a report and sends the app's batch a second later, so a burst becomes one request.
  private func record(_ report: UserAppAppErrorPost, from host: UserAppHost) {
    let kind = UserAppDiagnostic.Kind(rawValue: report.kind.rawValue) ?? .error
    let entry = UserAppDiagnostic(
      kind: kind, message: report.message, stack: report.stack, version: host.runtime.version,
      at: .now)
    diagnostics[host.appId, default: UserAppDiagnosticBuffer()].append(entry, at: .now)
    guard flushing.insert(host.appId).inserted else { return }
    let appId = host.appId
    let version = host.runtime.version
    Task {
      try? await Task.sleep(for: .seconds(1))
      flushing.remove(appId)
      guard let batch = diagnostics[appId]?.drain(version: version, at: .now), !batch.isEmpty
      else { return }
      do {
        try await services.client().postAppDiagnostics(appId: appId, entries: batch)
      } catch {
        let reason = String(describing: error)
        Self.log.error("App diagnostics were not sent: \(reason, privacy: .public)")
      }
    }
  }

  // MARK: Files

  /// The chosen files' names and bytes; empty when the user cancelled. Paths never reach the
  /// page. A file over ``UserAppBridgeContract/maxFileBytes`` fails the call.
  private func pick(_ params: UserAppFilesPickParams, for host: UserAppHost)
    async throws(BridgeError) -> [UserAppFile]
  {
    guard !isBusy() else { throw BridgeError("Finish the screenshot first.") }
    let types = try Self.contentTypes(params.types ?? [])
    let message = ShellStrings.shared.text(.userAppFilesPickTitle, host.runtime.name)
    guard
      let urls = await systemPanels?.chooseFiles(
        types: types, multiple: params.multiple ?? false, message: message)
    else { return [] }
    do {
      return try await Self.read(Array(urls.prefix(10)))
    } catch {
      throw BridgeError(ShellStrings.shared.text(.userAppFilesTooLarge))
    }
  }

  @concurrent
  private static func read(_ urls: [URL]) async throws -> [UserAppFile] {
    try urls.map { url in
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard size <= UserAppBridgeContract.maxFileBytes else { throw CocoaError(.fileReadTooLarge) }
      let bytes = try Data(contentsOf: url, options: .mappedIfSafe)
      guard bytes.count <= UserAppBridgeContract.maxFileBytes else {
        throw CocoaError(.fileReadTooLarge)
      }
      return UserAppFile(name: url.lastPathComponent, bytesBase64: bytes.base64EncodedString())
    }
  }

  /// `files.pick` types: filename extensions without the dot, or Uniform Type Identifiers. The
  /// contract's per-item pattern is checked here, since generated decoding checks only the list.
  private static func contentTypes(_ values: [String]) throws(BridgeError) -> [UTType] {
    try values.map { value throws(BridgeError) in
      let allowed = value.utf8.allSatisfy { byte in
        (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
          || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte)
          || (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) || ".+-".utf8.contains(byte)
      }
      guard allowed, (1...128).contains(value.utf8.count),
        let type = value.contains(".")
          ? UTType(value) : UTType(filenameExtension: value)
      else { throw BridgeError("Unknown file type \(value).") }
      return type
    }
  }

  /// Offers the bytes in the save panel, quarantined like any download. False when cancelled.
  private func save(_ params: UserAppFilesSaveParams) async throws(BridgeError) -> Bool {
    guard !isBusy() else { throw BridgeError("Finish the screenshot first.") }
    guard let bytes = Data(base64Encoded: params.bytesBase64),
      bytes.count <= UserAppBridgeContract.maxFileBytes
    else { throw BridgeError("The file content is not valid base64 of at most 8 MiB.") }
    let name = SavedFile.name(params.suggestedName, fallback: "download")
    guard let url = await systemPanels?.chooseSaveLocation(suggestedName: name) else {
      return false
    }
    do {
      try DownloadQuarantine.app.write(bytes, to: url)
      return true
    } catch {
      throw BridgeError(ShellStrings.shared.text(.fileSaveFailed))
    }
  }

  private static func encode(_ value: some Encodable) throws(BridgeError) -> Any {
    do {
      return try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    } catch {
      throw BridgeError("The reply could not be encoded.")
    }
  }
}
