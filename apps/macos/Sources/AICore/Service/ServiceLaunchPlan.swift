import Foundation

/// How a packaged shell starts its bundled service, mirroring `startLocalService` in
/// `apps/desktop/electron/service/launcher.ts` for the packaged branch only: the bundled Node
/// and service by absolute path, never a Node found on `PATH` (decision Q10).
public struct ServiceLaunchPlan: Equatable, Sendable {
  /// `Contents/Resources/node/bin/node`.
  public let node: URL
  /// `Contents/Resources/agent-service/dist/cli.js`.
  public let script: URL
  /// `Contents/Resources/agent-service/build-info.json`.
  public let buildInfo: URL
  public let dataDirectory: URL

  public init(resources: URL, dataDirectory: URL) {
    node = resources.appending(path: "node/bin/node", directoryHint: .notDirectory)
    script = resources.appending(path: "agent-service/dist/cli.js", directoryHint: .notDirectory)
    buildInfo = resources.appending(
      path: "agent-service/build-info.json", directoryHint: .notDirectory)
    self.dataDirectory = dataDirectory
  }

  /// `node <cli.js> serve --dataDir <dir> --login-shell-path`. The service resolves the login
  /// shell's `PATH` itself before it listens; the flag is off by default because a service
  /// started from a terminal already has the right one.
  public var arguments: [String] {
    [
      Self.path(of: script), "serve", "--dataDir", Self.path(of: dataDirectory),
      "--login-shell-path",
    ]
  }

  /// The child's environment: the app's own, with the bundled Node's directory appended to
  /// `PATH` so a bare `node` still resolves for users without one, as Electron's launcher did.
  /// This is the `PATH` the service starts with; `--login-shell-path` makes it resolve the login
  /// shell's itself, and it keeps this one when that times out.
  /// `AI_AGENT_DATA_DIR` is dropped: `--dataDir` names the directory, and the service would
  /// otherwise let the variable win over the flag.
  public func environment(inheriting parent: [String: String]) -> [String: String] {
    var environment = parent
    environment[ServiceDataDirectory.overrideVariable] = nil
    let nodeDirectory = Self.path(of: node.deletingLastPathComponent())
    let entries = (parent["PATH"] ?? "").split(separator: ":").map(String.init)
    environment["PATH"] = (entries.filter { $0 != nodeDirectory } + [nodeDirectory]).joined(
      separator: ":")
    return environment
  }

  /// A file-system path without the trailing slash a directory URL carries.
  public static func path(of url: URL) -> String {
    let path = url.path(percentEncoded: false)
    return path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
  }

  /// A running service is reused only when it runs this very build: both ids known and equal
  /// (`runsCurrentCode` in `autostart.ts`). Anything else is replaced.
  public static func canReuse(running: String?, bundled: String?) -> Bool {
    guard let running, let bundled else { return false }
    return running == bundled
  }

  /// The `buildId` of a `build-info.json` (`{ version: 1, buildId }`); nil when it cannot be read,
  /// which makes every running service a replacement candidate.
  public static func parseBuildInfo(_ data: Data) -> String? {
    struct BuildInfo: Decodable {
      let version: Int
      let buildId: String
    }
    guard let info = try? JSONDecoder().decode(BuildInfo.self, from: data), info.version == 1,
      (1...128).contains(info.buildId.count)
    else { return nil }
    return info.buildId
  }
}

/// Log file names of the supervised service: `service.log` for the current launch and
/// `service.1.log` (newest) … `service.4.log` for earlier ones, as `service-log.ts` keeps them.
public enum ServiceLogRotation {
  public static let current = "service.log"
  public static let keptPrevious = 4

  /// Renames to apply, oldest first, before opening a fresh ``current``.
  public static func renames() -> [(from: String, to: String)] {
    stride(from: keptPrevious, through: 1, by: -1).map { index in
      (index == 1 ? current : "service.\(index - 1).log", "service.\(index).log")
    }
  }
}
