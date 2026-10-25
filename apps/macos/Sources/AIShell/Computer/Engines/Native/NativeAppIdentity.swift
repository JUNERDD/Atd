import AICore
import AppKit
import Security

/// Who an installed app is, read from its bundle and its code signature: what an application
/// binding records when a person chooses the app, and what resolving checks the app at that path
/// still is. The signature is read, not validated (validation hashes the whole bundle); the team
/// only has to stay the one recorded.
nonisolated struct NativeAppIdentity: Equatable, Sendable {
  let bundleId: String
  let name: String
  /// The `.app` path, symlinks resolved.
  let path: String
  /// The code-signing team, nil for an app signed without one (ad hoc, Apple's own).
  let teamId: String?

  /// The app at `path`, nil when no app bundle is there.
  static func read(path: String) -> NativeAppIdentity? {
    let url = URL(filePath: path, directoryHint: .isDirectory).resolvingSymlinksInPath()
    guard let bundle = Bundle(url: url), let bundleId = bundle.bundleIdentifier,
      url.pathExtension == "app"
    else { return nil }
    let name =
      bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
      ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
      ?? url.deletingPathExtension().lastPathComponent
    return NativeAppIdentity(
      bundleId: bundleId, name: String(name.prefix(255)), path: url.path(percentEncoded: false),
      teamId: teamId(of: url))
  }

  private static func teamId(of url: URL) -> String? {
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code else {
      return nil
    }
    var info: CFDictionary?
    guard
      SecCodeCopySigningInformation(
        code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
      let values = info as? [String: Any],
      let team = values[kSecCodeInfoTeamIdentifier as String] as? String, !team.isEmpty
    else { return nil }
    return String(team.prefix(32))
  }

  /// The version of the app at `path` (`CFBundleShortVersionString (CFBundleVersion)`), which a
  /// demotion is keyed by; empty when the bundle names none.
  static func version(path: String) -> String {
    let info = Bundle(url: URL(filePath: path, directoryHint: .isDirectory))?.infoDictionary
    let short = info?["CFBundleShortVersionString"] as? String ?? ""
    let build = info?["CFBundleVersion"] as? String ?? ""
    return build.isEmpty ? short : "\(short) (\(build))"
  }

  /// The running, unterminated instances of this app: its bundle id launched from its path
  /// (symlinks such as `/tmp` and `/var` resolved on both sides).
  func runningInstances() -> [NSRunningApplication] {
    let own = Self.canonical(path)
    return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { app in
      !app.isTerminated
        && app.bundleURL.map { Self.canonical($0.path(percentEncoded: false)) } == own
    }
  }

  private static func canonical(_ path: String) -> String {
    URL(filePath: path, directoryHint: .isDirectory).resolvingSymlinksInPath().standardizedFileURL
      .path(percentEncoded: false)
  }
}

/// The app an application binding names: the app installed at the binding's path, still with its
/// bundle id and recorded team, and whether it runs, which must be exactly once. Reading it never
/// launches or activates the app; resolving starts one that is not running
/// (``NativeEngine/launchInBackground(_:_:until:)``).
enum NativeApplicationTarget {
  enum State {
    case running(NSRunningApplication)
    /// Installed as bound, with no running instance.
    case notRunning(NativeAppIdentity)
  }

  static func state(_ native: TargetBindingWire.Native) async -> Result<State, ComputerFailure> {
    let path = native.appPath
    let identity = await NativeTargetProbe.detached { NativeAppIdentity.read(path: path) }
    guard let identity, identity.bundleId == native.bundleId else {
      return .failure(
        ComputerFailure(
          .targetUnavailable,
          "\(native.appName) is no longer installed at \(path); choose the app again in Settings."))
    }
    if let team = native.teamId, identity.teamId != team {
      return .failure(
        ComputerFailure(
          .targetUnavailable,
          "\(native.appName) at \(path) is signed by another developer than when it was chosen; "
            + "choose the app again in Settings."))
    }
    let running = identity.runningInstances()
    guard let app = running.first else { return .success(.notRunning(identity)) }
    guard running.count == 1 else {
      return .failure(
        ComputerFailure(.ambiguous, "More than one copy of \(native.appName) is running."))
    }
    return .success(.running(app))
  }
}
