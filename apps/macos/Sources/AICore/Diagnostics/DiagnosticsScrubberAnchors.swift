import CryptoKit
import Foundation

/// Allowlist-based anonymizer for `frontmostBundleId` (`04` §1.3).
///
/// Preserves Atd, `com.apple.*`, and mainstream public browsers/editors/remote-input tools while
/// hashing private or enterprise bundle identifiers to `"app#<sha256-8>"`.
public nonisolated enum BundleIdentifierRedactor {
  public static let allowedExact: Set<String> = [
    "com.junerdd.ai",
    "com.junerdd.ai.dev",
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "company.thebrowser.Browser",
    "com.microsoft.edgemac",
    "com.brave.Browser",
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.todesktop.230313mzl4w4u92",
    "dev.zed.Zed",
    "dev.zed.Zed-Preview",
    "com.kingsoft.wpsoffice.mac",
    "com.netease.uuremote",
    "com.googlecode.iterm2",
    "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty",
    "md.obsidian",
    "notion.id",
    "com.tinyspeck.slackmacgap",
    "com.tencent.xinWeChat",
    "com.electron.lark",
    "com.bytedance.lark",
  ]

  public static func redact(_ bundleIdentifier: String?) -> String? {
    guard let bundleIdentifier, !bundleIdentifier.isEmpty else { return nil }
    if bundleIdentifier.hasPrefix("app#") && bundleIdentifier.count == 12 {
      return bundleIdentifier
    }
    if bundleIdentifier.hasPrefix("com.apple.") || allowedExact.contains(bundleIdentifier) {
      return bundleIdentifier
    }
    let digest = SHA256.hash(data: Data(bundleIdentifier.utf8))
    let prefixHex = digest.prefix(4).map { String(format: "%02x", $0) }.joined()
    return "app#\(prefixHex)"
  }
}

extension DiagnosticsScrubber {
  /// Host-derived path and word anchors for Pass A.
  public struct EnvironmentAnchors: Equatable, Sendable {
    struct ReplacementPair: Equatable, Sendable {
      let source: String
      let target: String
    }

    let pathReplacements: [ReplacementPair]
    let wordReplacements: [ReplacementPair]

    public static let current: Self = {
      let home = FileManager.default.homeDirectoryForCurrentUser.path(percentEncoded: false)
      let resolvedHome = URL(filePath: home).resolvingSymlinksInPath().path(percentEncoded: false)
      var tmpCandidates: [String] = [NSTemporaryDirectory()]
      if let envTmp = ProcessInfo.processInfo.environment["TMPDIR"], !envTmp.isEmpty {
        tmpCandidates.append(envTmp)
        tmpCandidates.append(
          URL(filePath: envTmp).resolvingSymlinksInPath().path(percentEncoded: false))
      }
      let host = ProcessInfo.processInfo.hostName
      let shortHost = host.hasSuffix(".local") ? String(host.dropLast(6)) : host
      return Self(
        homePaths: [home, resolvedHome],
        tmpPaths: tmpCandidates,
        usernames: [NSUserName(), NSFullUserName()],
        hostnames: [host, shortHost])
    }()

    public init(
      homePaths: [String],
      tmpPaths: [String],
      usernames: [String],
      hostnames: [String]
    ) {
      var paths: [ReplacementPair] = []
      for raw in homePaths {
        let trimmed = Self.trimSlash(raw)
        if trimmed.count > 1 && !paths.contains(where: { $0.source == trimmed }) {
          paths.append(ReplacementPair(source: trimmed, target: "~"))
        }
      }
      for raw in tmpPaths {
        let trimmed = Self.trimSlash(raw)
        if trimmed.count > 4 && !paths.contains(where: { $0.source == trimmed }) {
          paths.append(ReplacementPair(source: trimmed, target: "$TMPDIR"))
        }
      }
      paths.sort { $0.source.count > $1.source.count }
      self.pathReplacements = paths

      var words: [ReplacementPair] = []
      for user in usernames {
        let clean = user.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.isEligibleAnchorWord(clean) && !words.contains(where: { $0.source == clean }) {
          words.append(ReplacementPair(source: clean, target: "<user>"))
        }
      }
      for host in hostnames {
        let clean = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.isEligibleAnchorWord(clean) && !words.contains(where: { $0.source == clean }) {
          words.append(ReplacementPair(source: clean, target: "<host>"))
        }
      }
      words.sort { $0.source.count > $1.source.count }
      self.wordReplacements = words
    }

    private static func trimSlash(_ path: String) -> String {
      let clean = path.trimmingCharacters(in: .whitespacesAndNewlines)
      return clean.count > 1 && clean.hasSuffix("/") ? String(clean.dropLast()) : clean
    }

    private static func isEligibleAnchorWord(_ token: String) -> Bool {
      token.count >= 3 && !DiagnosticsScrubberRules.reservedWords.contains(token.lowercased())
    }
  }
}
