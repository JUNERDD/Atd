import Foundation

/// How the shell starts the managed Chrome of a browser profile (D16): the installed Google
/// Chrome, found by bundle id, on a host-created profile directory, with a DevTools endpoint on
/// loopback whose port Chrome picks and writes to `DevToolsActivePort`. The port never comes
/// from the model or the page, and the person's own profile is never opened with it.
public enum ManagedChromeLaunch {
  public static let bundleIdentifier = "com.google.Chrome"
  /// The file Chrome writes into the profile directory: the port, then the browser target path.
  public static let activePortFile = "DevToolsActivePort"
  /// Chrome's per-profile instance lock, a symlink to `<host>-<pid>` while a browser runs on it.
  public static let singletonLock = "SingletonLock"

  /// The command line of a managed browser on `profile`. `startUrl`, when given, opens in a
  /// window (attended); a running browser of the same profile receives it instead of starting
  /// a second one.
  public static func arguments(profile: URL, startUrl: String?) -> [String] {
    [
      "--user-data-dir=\(profile.path(percentEncoded: false))",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
    ] + (startUrl.map { [$0] } ?? [])
  }

  /// The command line of a managed browser started for a run, with no person at the screen
  /// (plan §7, cold-start method A, verified by the S8 probe): no window opens at launch, and
  /// windows keep rendering while another window covers them. The first window is opened over
  /// DevTools, in the background, and parked (``BrowserWindowPlacement``). `--window-position` is
  /// left out on purpose: it does not move that window, and it would move the ones the person
  /// opens later.
  public static func backgroundArguments(profile: URL) -> [String] {
    arguments(profile: profile, startUrl: nil) + [
      "--no-startup-window",
      "--disable-backgrounding-occluded-windows",
    ]
  }

  /// A fresh profile id (`Identifier`, D4).
  public static func newProfileId() -> String {
    "chrome-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  }

  /// Whether `id` can name a profile directory: an `Identifier`, so never a path.
  public static func isProfileId(_ id: String) -> Bool {
    (1...128).contains(id.count)
      && id.unicodeScalars.allSatisfy { scalar in
        scalar.isASCII
          && (CharacterSet.alphanumerics.contains(scalar) || scalar == "-" || scalar == "_")
      }
  }

  /// The pid `SingletonLock` names (its target is `<hostname>-<pid>`), or nil.
  public static func lockOwner(_ target: String) -> Int32? {
    guard let dash = target.lastIndex(of: "-") else { return nil }
    return Int32(target[target.index(after: dash)...]).flatMap { $0 > 0 ? $0 : nil }
  }

  /// How long a browser worker that exited on its own waits before its next start: doubling
  /// from half a second, at most eight seconds.
  public static func restartDelay(afterCrashes crashes: Int) -> Duration {
    guard crashes > 0 else { return .zero }
    let exponent = min(crashes - 1, 4)
    return .milliseconds(500 * (1 << exponent))
  }
}

/// The contents of `DevToolsActivePort`: the port Chrome bound on loopback and the path of its
/// browser target. A port is trusted only when the endpoint's `/json/version` names the same
/// browser target, so a stale file or another listener on a reused port is never driven.
public struct DevToolsActivePort: Equatable, Sendable {
  public let port: Int
  public let browserPath: String

  public init?(contents: String) {
    let lines = contents.split(whereSeparator: \.isNewline).map(String.init)
    guard lines.count >= 2, let port = Int(lines[0]), (1...65535).contains(port),
      lines[1].hasPrefix("/devtools/browser/"), lines[1].count <= 200
    else { return nil }
    self.port = port
    browserPath = lines[1]
  }

  /// `http://127.0.0.1:<port>/json/version`.
  public var versionURL: URL? { URL(string: "http://127.0.0.1:\(port)/json/version") }

  /// Whether `/json/version`'s `webSocketDebuggerUrl` is this browser on this port.
  public func matches(webSocketDebuggerUrl: String) -> Bool {
    guard let url = URLComponents(string: webSocketDebuggerUrl) else { return false }
    return url.scheme == "ws" && url.port == port
      && (url.host == "127.0.0.1" || url.host == "localhost") && url.path == browserPath
  }
}
