import Foundation

/// File names for downloaded artifacts, as `dispositionName` in `@atd/agent-client` derives them.
public enum ArtifactFileName {
  public static let fallback = "download.bin"

  /// The name a `Content-Disposition` header carries: `filename*=UTF-8''…` first, then
  /// `filename="…"`, else ``fallback``.
  public static func fromDisposition(_ header: String?) -> String {
    guard let header else { return fallback }
    if let encoded = capture(#"filename\*=UTF-8''([^;]+)"#, in: header, caseInsensitive: true),
      let decoded = encoded.removingPercentEncoding
    {
      return decoded
    }
    return capture(#"filename="([^"]+)""#, in: header, caseInsensitive: false) ?? fallback
  }

  /// A name safe to use as one file-name component: path separators and characters Windows and
  /// shells treat specially become `_`, at most 200 characters, never empty. A name made only
  /// of dots would still name a directory, so it is replaced too.
  public static func safe(_ name: String) -> String {
    let forbidden: Set<Character> = ["/", "\\", "?", "%", "*", ":", "|", "\"", "<", ">"]
    let cleaned = String(
      name.map { forbidden.contains($0) || $0.isNewline || $0 == "\0" ? "_" : $0 }.prefix(200))
    return cleaned.isEmpty || cleaned.allSatisfy({ $0 == "." }) ? fallback : cleaned
  }

  /// `<artifactId>-<safe name>`: the id keeps downloads of equally named artifacts apart.
  public static func downloadName(artifactId: String, name: String) -> String {
    safe("\(artifactId)-\(safe(name))")
  }

  private static func capture(_ pattern: String, in text: String, caseInsensitive: Bool)
    -> String?
  {
    guard
      let expression = try? NSRegularExpression(
        pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []),
      let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
      let range = Range(match.range(at: 1), in: text)
    else { return nil }
    return String(text[range])
  }
}
