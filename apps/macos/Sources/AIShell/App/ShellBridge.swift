import AICore
import Foundation

/// The shell's own bridge methods, with every other method handed to the router integration
/// supplies. Method names and payloads are provisional until the TypeBox bridge contract
/// (plan P3) lands; integration renames them here. Payloads are validated at this boundary.
@MainActor
final class ShellBridge: BridgeRouting {
  weak var shell: ShellController?
  private let fallback: any BridgeRouting

  init(fallback: any BridgeRouting) {
    self.fallback = fallback
  }

  func route(_ call: BridgeCall) async throws(BridgeError) -> JSONValue {
    guard let shell else { throw BridgeError("The shell is shutting down.") }
    let params = call.params
    switch call.method {
    case "window.show":
      shell.showPanel()
    case "window.hide":
      shell.hidePanel()
    case "window.setPinned":
      shell.setPinned(try Self.bool(params, "pinned"))
    case "window.preferences":
      return shell.windowPreferences()
    case "app.setShowInDock":
      shell.setShowInDock(try Self.bool(params, "show"))
    case "app.setOpenAtLogin":
      do {
        let applied = try AppPresence.setOpensAtLogin(try Self.bool(params, "enabled"))
        return .object(["openAtLogin": .bool(applied)])
      } catch let error as BridgeError {
        throw error
      } catch {
        throw BridgeError(ShellCapabilities.message(error, "The login item could not change."))
      }
    case "settings.open":
      shell.openSettings(fragment: params.string("fragment"))
    case "shortcuts.apply":
      return try Self.encode(
        shell.applyHotKeys(try Self.decode([HotKeyRequest].self, params["items"])))
    case "selection.setWanted":
      shell.setSelectionWanted(try Self.bool(params, "wanted"))
    case "capture":
      return try Self.encode(shell.capture(try Self.string(params, "source")))
    case "language.set":
      guard shell.setLanguage(try Self.string(params, "language")) else {
        throw BridgeError("Unsupported language.")
      }
    case "attachments.pick":
      Task { await shell.attachments.pick() }
    case "artifact":
      let id = try Self.string(params, "artifactId")
      guard let operation = ArtifactOperation(rawValue: try Self.string(params, "operation")) else {
        throw BridgeError("Unsupported artifact operation.")
      }
      return try await shell.artifacts.perform(artifactId: id, operation: operation)
    case "openLink":
      try shell.openLink(try Self.string(params, "url"))
    case "clipboard.write":
      shell.copy(try Self.string(params, "text"))
    default:
      return try await fallback.route(call)
    }
    return .null
  }

  private static func bool(_ params: JSONValue, _ key: String) throws(BridgeError) -> Bool {
    guard let value = params.bool(key) else { throw BridgeError("\(key) must be a boolean.") }
    return value
  }

  private static func string(_ params: JSONValue, _ key: String) throws(BridgeError) -> String {
    guard let value = params.string(key) else { throw BridgeError("\(key) must be a string.") }
    return value
  }

  private static func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue?)
    throws(BridgeError) -> T
  {
    do {
      return try (value ?? .null).decode(type)
    } catch {
      throw BridgeError("Invalid bridge payload.")
    }
  }

  private static func encode(_ value: some Encodable) throws(BridgeError) -> JSONValue {
    do {
      return try JSONValue(encoding: value)
    } catch {
      throw BridgeError("The reply could not be encoded.")
    }
  }
}
