import Foundation

/// Content types of the files a renderer build contains. The handler answers every file with an
/// explicit type and `nosniff`, so a file whose extension is missing here is served as opaque
/// bytes, never guessed into a script or a document.
public enum RendererMIMEType {
  public static let fallback = "application/octet-stream"

  /// Lower-cased extension → content type.
  public static let table: [String: String] = [
    "html": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "mjs": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "map": "application/json; charset=utf-8",
    "webmanifest": "application/manifest+json; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "ico": "image/x-icon",
    "woff": "font/woff",
    "woff2": "font/woff2",
    "ttf": "font/ttf",
    "otf": "font/otf",
    "wasm": "application/wasm",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "mp4": "video/mp4",
    "webm": "video/webm",
  ]

  public static func forFile(named name: String) -> String {
    guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return fallback }
    return table[name[name.index(after: dot)...].lowercased()] ?? fallback
  }

  /// Whether a content type is an HTML document, which gets the CSP header.
  public static func isHTML(_ contentType: String?) -> Bool {
    guard let contentType else { return false }
    let essence = contentType.split(separator: ";", maxSplits: 1).first ?? ""
    return essence.trimmingCharacters(in: .whitespaces).lowercased() == "text/html"
  }
}
