import Foundation

/// Pass C URL, DSN, Figma link, and Cloudflare account sanitizer (`04` §3.2).
///
/// Runs strictly BEFORE Pass A/B host/user/path replacements so angle brackets in `<host>` /
/// `<user>` never prematurely split URL regex matching.
nonisolated enum DiagnosticsScrubberURLSanitizer {
  private static let allowedPublicHosts: Set<String> = [
    "127.0.0.1", "localhost", "::1", "[::1]", "renderer", "view", "atd.best",
    "api.openai.com", "auth.openai.com", "chatgpt.com", "api.anthropic.com",
    "openrouter.ai", "generativelanguage.googleapis.com", "github.com", "api.github.com",
  ]

  private static let figmaFileRegex = try! NSRegularExpression(
    pattern:
      #"^https?://(?:www\.)?figma\.com/(?:design|file|proto|board)/[A-Za-z0-9]{15,}[^\s"'`\\<>)\]}]*$"#
  )
  private static let figmaAssetRegex = try! NSRegularExpression(
    pattern: #"^https?://(?:www\.)?figma\.com/api/mcp/asset/[A-Za-z0-9._/-]+"#
  )
  private static let cfAccountKvRegex = try! NSRegularExpression(
    pattern: #"(?i)(account_id(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)([a-f0-9]{32})"#
  )
  private static let genericUrlRegex = try! NSRegularExpression(
    pattern: #"\b([a-zA-Z][a-zA-Z0-9+.-]{1,15})://([^\s"'`\\<>)\]}]+)"#
  )
  private static let homePathRegex = try! NSRegularExpression(
    pattern: #"/(?:Users|home)/([A-Za-z0-9_.-]+)"#
  )

  static func apply(_ input: String, priorHits: Int) -> (String, Int) {
    var text = input
    var hits = priorHits

    let ns = text as NSString
    let matches = genericUrlRegex.matches(in: text, range: NSRange(location: 0, length: ns.length))
    if !matches.isEmpty {
      let out = NSMutableString(string: text)
      for match in matches.reversed() {
        // Skip URLs already ending at an existing `<redacted-...>` placeholder for idempotency.
        if match.range.upperBound < ns.length && ns.character(at: match.range.upperBound) == 0x3C {
          continue
        }
        var fullRange = match.range
        var rawUrl = ns.substring(with: fullRange)
        while let last = rawUrl.last, ".,;:".contains(last) {
          rawUrl.removeLast()
          fullRange.length -= 1
        }
        let scheme = ns.substring(with: match.range(at: 1))
        let (sanitized, urlHit) = sanitizeSingleURL(rawUrl, scheme: scheme)
        if urlHit > 0 && sanitized != rawUrl {
          out.replaceCharacters(in: fullRange, with: sanitized)
          hits += urlHit
        }
      }
      text = out as String
    }

    text = DiagnosticsScrubberRules.replace(
      cfAccountKvRegex, in: text, with: "$1<redacted-account-id>", hits: &hits)
    return (text, hits)
  }

  private static func sanitizeSingleURL(_ rawUrl: String, scheme: String) -> (String, Int) {
    let urlRange = NSRange(rawUrl.startIndex..., in: rawUrl)
    if figmaAssetRegex.firstMatch(in: rawUrl, range: urlRange) != nil {
      return ("https://figma.com/api/mcp/asset/<redacted-figma-asset>", 1)
    }
    if figmaFileRegex.firstMatch(in: rawUrl, range: urlRange) != nil {
      return ("https://figma.com/design/<redacted-figma-file>", 1)
    }

    let lowerScheme = scheme.lowercased()
    if lowerScheme == "ai-app" || lowerScheme == "ai-view" || lowerScheme == "ai-userapp" {
      guard var components = URLComponents(string: rawUrl) else {
        return ("\(scheme)://<redacted-url>", 1)
      }
      var changed = 0
      if components.query != nil {
        components.query = nil
        changed += 1
      }
      if components.fragment != nil {
        components.fragment = nil
        changed += 1
      }
      guard changed > 0, let base = components.string else { return (rawUrl, 0) }
      return (base + (rawUrl.contains("?") ? "?<redacted>" : ""), changed)
    }

    guard let components = URLComponents(string: rawUrl) else {
      return ("\(scheme)://<redacted-url>", 1)
    }
    if lowerScheme == "file" {
      let path = components.path
      if path.contains("/Library/Logs/")
        || path.contains("/Library/Application Support/AgentService")
      {
        let cleaned = homePathRegex.stringByReplacingMatches(
          in: path, range: NSRange(path.startIndex..., in: path), withTemplate: "/Users/<user>")
        return ("file://\(cleaned)", cleaned == path && components.query == nil ? 0 : 1)
      }
      return ("file:///Users/<user>/<redacted-file>", 1)
    }

    let host = (components.host ?? "").lowercased()
    if host == "dash.cloudflare.com" {
      return ("https://dash.cloudflare.com/<redacted-account-id>", 1)
    }
    if host == "figma.com" || host == "www.figma.com" {
      if components.path.hasPrefix("/api/mcp/asset/") {
        return ("https://figma.com/api/mcp/asset/<redacted-figma-asset>", 1)
      }
      return ("https://figma.com/design/<redacted-figma-file>", 1)
    }

    let hasAuth = components.user != nil || components.password != nil
    let hasQuery = components.query != nil
    let hasFragment = components.fragment != nil
    let hostAllowed = allowedPublicHosts.contains(host) || host.hasSuffix(".atd.best")

    if hostAllowed && !hasAuth && !hasQuery && !hasFragment {
      return (rawUrl, 0)
    }
    let authPrefix = hasAuth ? "<redacted>@" : ""
    let renderedHost: String
    let renderedPath: String
    if hostAllowed {
      let portSuffix = components.port.map { ":\($0)" } ?? ""
      renderedHost = "\(components.host ?? host)\(portSuffix)"
      renderedPath = components.percentEncodedPath
    } else {
      renderedHost = "<redacted-host>"
      let parts = components.percentEncodedPath.split(separator: "/")
      if parts.isEmpty {
        renderedPath = components.percentEncodedPath.hasPrefix("/") ? "/" : ""
      } else if let first = parts.first,
        ["v1", "v2", "api"].contains(first.lowercased()),
        parts.count > 1
      {
        renderedPath = "/\(first)/<redacted-path>"
      } else {
        renderedPath = "/<redacted-path>"
      }
    }
    let querySuffix = hasQuery ? "?<redacted>" : ""
    let fragSuffix = hasFragment ? "#<redacted>" : ""
    return ("\(scheme)://\(authPrefix)\(renderedHost)\(renderedPath)\(querySuffix)\(fragSuffix)", 1)
  }
}
