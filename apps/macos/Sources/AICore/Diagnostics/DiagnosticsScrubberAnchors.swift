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
  /// Host-derived path and word anchors for Pass A with precompiled regexes (`B3`).
  public struct EnvironmentAnchors: Equatable, Sendable {
    struct ReplacementPair: Equatable, Sendable {
      let source: String
      let target: String
      let requiredLetterMask: UInt32
      let lowerASCIIBytes: [UInt8]?
      let lowerCString: ContiguousArray<CChar>?
      let requiresNonASCII: Bool
      let regex: NSRegularExpression

      init(source: String, target: String, pattern: String) {
        self.source = source
        self.target = target
        self.requiredLetterMask = DiagnosticsScrubberFastScan.asciiLetterMask(for: source.utf8)
        if source.utf8.allSatisfy({ $0 > 0 && $0 < 0x80 }) {
          let lowered = source.utf8.map(DiagnosticsScrubberFastScan.lowerASCII)
          self.lowerASCIIBytes = lowered
          var cChars = ContiguousArray<CChar>()
          cChars.reserveCapacity(lowered.count + 1)
          for b in lowered { cChars.append(CChar(bitPattern: b)) }
          cChars.append(0)
          self.lowerCString = cChars
          self.requiresNonASCII = false
        } else {
          self.lowerASCIIBytes = nil
          self.lowerCString = nil
          self.requiresNonASCII = !source.lowercased().utf8.allSatisfy({ $0 < 0x80 })
        }
        self.regex = try! NSRegularExpression(pattern: pattern)
      }

      static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.source == rhs.source && lhs.target == rhs.target
      }

      func mayAppear(
        in text: String, features: DiagnosticsScrubberFastScan.UTF8Features
      ) -> Bool {
        guard (features.letterMask & requiredLetterMask) == requiredLetterMask else {
          return false
        }
        if let ascii = lowerASCIIBytes {
          return DiagnosticsScrubberFastScan.containsCaseInsensitiveASCII(text, lowerNeedle: ascii)
        }
        if requiresNonASCII && !features.hasNonASCII {
          return false
        }
        return text.range(of: source, options: .caseInsensitive) != nil
      }
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
      var rawPaths: [(source: String, target: String)] = []
      for raw in homePaths {
        let trimmed = Self.trimSlash(raw)
        if trimmed.count > 1 && !rawPaths.contains(where: { $0.source == trimmed }) {
          rawPaths.append((trimmed, "~"))
        }
      }
      for raw in tmpPaths {
        let trimmed = Self.trimSlash(raw)
        if trimmed.count > 4 && !rawPaths.contains(where: { $0.source == trimmed }) {
          rawPaths.append((trimmed, "$TMPDIR"))
        }
      }
      rawPaths.sort { $0.source.count > $1.source.count }
      self.pathReplacements = rawPaths.map { item in
        let pattern =
          NSRegularExpression.escapedPattern(for: item.source) + #"(?=$|/|\\|\s|["'`,;:)\]}])"#
        return ReplacementPair(source: item.source, target: item.target, pattern: pattern)
      }

      var rawWords: [(source: String, target: String)] = []
      for user in usernames {
        let clean = user.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.isEligibleAnchorWord(clean) && !rawWords.contains(where: { $0.source == clean }) {
          rawWords.append((clean, "<user>"))
        }
      }
      for host in hostnames {
        let clean = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.isEligibleAnchorWord(clean) && !rawWords.contains(where: { $0.source == clean }) {
          rawWords.append((clean, "<host>"))
        }
      }
      rawWords.sort { $0.source.count > $1.source.count }
      self.wordReplacements = rawWords.map { item in
        let pattern =
          #"(?<![A-Za-z0-9<])"# + NSRegularExpression.escapedPattern(for: item.source)
          + #"(?![A-Za-z0-9>])"#
        return ReplacementPair(source: item.source, target: item.target, pattern: pattern)
      }
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
