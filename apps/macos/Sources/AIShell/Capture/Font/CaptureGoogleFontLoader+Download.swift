import Foundation

extension CaptureGoogleFontLoader {
  nonisolated static func downloadFontData(family: String) async -> (
    family: String, data: Data, ext: String
  )? {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 8
    config.timeoutIntervalForResource = 15
    let session = URLSession(configuration: config)
    defer { session.finishTasksAndInvalidate() }

    guard let css = await fetchCSS(family: family, session: session),
      let parsed = parseCSS(css, fallbackFamily: family)
    else { return nil }
    var request = URLRequest(url: parsed.fontURL, timeoutInterval: 8)
    request.setValue("Mozilla/4.0", forHTTPHeaderField: "User-Agent")
    guard let (data, response) = try? await session.data(for: request),
      let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode),
      http.expectedContentLength <= Int64(maxDownloadBytes),
      data.count <= maxDownloadBytes,
      let ext = validatedFontExtension(for: data)
    else { return nil }
    return (parsed.family, data, ext)
  }

  private nonisolated static func fetchCSS(family: String, session: URLSession) async -> String? {
    for suffix in [":wght@600", ""] {
      var comps = URLComponents(string: "https://fonts.googleapis.com/css2")
      comps?.queryItems = [
        URLQueryItem(name: "family", value: "\(family)\(suffix)"),
        URLQueryItem(name: "display", value: "swap"),
      ]
      guard let url = comps?.url else { continue }
      var req = URLRequest(url: url, timeoutInterval: 8)
      req.setValue("Mozilla/4.0", forHTTPHeaderField: "User-Agent")
      if let (data, response) = try? await session.data(for: req),
        let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode),
        let text = String(data: data, encoding: .utf8),
        text.contains("https://")
      {
        return text
      }
    }
    return nil
  }

  private nonisolated static func parseCSS(_ css: String, fallbackFamily: String) -> (
    family: String, fontURL: URL
  )? {
    let parsedFamily =
      firstCapture(in: css, pattern: #"font-family:\s*'([^']+)'"#) ?? fallbackFamily
    let urlString =
      firstCapture(
        in: css, pattern: #"url\((https://fonts\.gstatic\.com/[^)]+\.(?:ttf|otf|ttc))\)"#)
      ?? firstCapture(in: css, pattern: #"url\((https://fonts\.gstatic\.com/[^)]+)\)"#)
    guard let urlString, let url = URL(string: urlString) else { return nil }
    return (parsedFamily, url)
  }

  private nonisolated static func firstCapture(in text: String, pattern: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = regex.firstMatch(in: text, range: range),
      match.numberOfRanges > 1,
      let r = Range(match.range(at: 1), in: text)
    else { return nil }
    return String(text[r])
  }

  private nonisolated static func validatedFontExtension(for data: Data) -> String? {
    guard data.count >= 4 else { return nil }
    let bytes = [UInt8](data.prefix(4))
    if bytes == [0x00, 0x01, 0x00, 0x00] { return "ttf" }
    if bytes == [0x4F, 0x54, 0x54, 0x4F] { return "otf" }
    if bytes == [0x74, 0x74, 0x63, 0x66] { return "ttc" }
    return nil
  }

  nonisolated static func evictDiskCacheIfNeeded(keeping protectedURLs: Set<URL>) {
    let fm = FileManager.default
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
    guard
      let files = try? fm.contentsOfDirectory(
        at: cacheDirectory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
    else { return }
    var entries: [(url: URL, size: Int64, date: Date)] = []
    var total: Int64 = 0
    for url in files {
      let vals = try? url.resourceValues(forKeys: Set(keys))
      let size = Int64(vals?.fileSize ?? 0)
      total += size
      entries.append((url, size, vals?.contentModificationDate ?? .distantPast))
    }
    guard total > maxDiskBytes else { return }
    for item in entries.sorted(by: { $0.date < $1.date }) {
      guard total > maxDiskBytes else { break }
      if !protectedURLs.contains(item.url.standardizedFileURL),
        (try? fm.removeItem(at: item.url)) != nil
      {
        total -= item.size
      }
    }
  }
}
