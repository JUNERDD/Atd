import CryptoKit
import Darwin
import Foundation

/// Bounded log tail readers (`01` §8.1), `64 KiB` streaming file writer, and `/usr/bin/ditto`
/// compressor backing ``DiagnosticsBundleBuilder``.
nonisolated enum DiagnosticsLogTailReader {
  static func collectShellTail(shellLogURL: URL?, dataDirectoryURL: URL? = nil) -> Data? {
    collectTwoFileTail(
      logURL: shellLogURL,
      perFileBytes: DiagnosticsBundleBuilder.shellTailPerFileBytes,
      maxCombinedBytes: DiagnosticsBundleBuilder.maxCombinedLogTailBytes,
      dataDirectoryURL: dataDirectoryURL)
  }

  static func collectChromeExtensionTail(
    chromeExtensionLogURL: URL?, dataDirectoryURL: URL? = nil
  ) -> Data? {
    collectTwoFileTail(
      logURL: chromeExtensionLogURL,
      perFileBytes: DiagnosticsBundleBuilder.chromeExtensionTailPerFileBytes,
      maxCombinedBytes: DiagnosticsBundleBuilder.maxCombinedChromeExtensionTailBytes,
      dataDirectoryURL: dataDirectoryURL)
  }

  private static func collectTwoFileTail(
    logURL: URL?, perFileBytes: Int, maxCombinedBytes: Int, dataDirectoryURL: URL?
  ) -> Data? {
    guard let logURL,
      !DiagnosticsPathPolicy.isHardExcludedSource(logURL, dataDirectoryURL: dataDirectoryURL)
    else {
      return nil
    }
    let dir = logURL.deletingLastPathComponent()
    let base = logURL.deletingPathExtension().lastPathComponent
    let ext = logURL.pathExtension
    let rotated1 = dir.appending(path: "\(base).1.\(ext)", directoryHint: .notDirectory)
    var chunks: [Data] = []
    if let older = DiagnosticsBundleBuilder.readTailSlice(
      of: rotated1, maxBytes: perFileBytes, dataDirectoryURL: dataDirectoryURL),
      !older.isEmpty
    {
      chunks.append(older)
    }
    if let current = DiagnosticsBundleBuilder.readTailSlice(
      of: logURL, maxBytes: perFileBytes, dataDirectoryURL: dataDirectoryURL),
      !current.isEmpty
    {
      chunks.append(current)
    }
    guard !chunks.isEmpty else { return nil }
    return joinAndCapTail(chunks, maxBytes: maxCombinedBytes)
  }

  static func collectServiceTail(
    logDir: URL?, ringLines: [String], snapshotJSON: Data?, dataDirectoryURL: URL? = nil
  ) -> Data? {
    var chunks: [Data] = []
    if let logDir,
      !DiagnosticsPathPolicy.isHardExcludedSource(logDir, dataDirectoryURL: dataDirectoryURL)
    {
      for (name, cap) in [
        ("service.2.log", DiagnosticsBundleBuilder.serviceRotatedTailBytes),
        ("service.1.log", DiagnosticsBundleBuilder.serviceRotatedTailBytes),
        ("service.log", DiagnosticsBundleBuilder.servicePrimaryTailBytes),
      ] {
        let file = logDir.appending(path: name, directoryHint: .notDirectory)
        if let slice = DiagnosticsBundleBuilder.readTailSlice(
          of: file, maxBytes: cap, dataDirectoryURL: dataDirectoryURL),
          !slice.isEmpty
        {
          chunks.append(slice)
        }
      }
    }
    let effectiveRingLines =
      ringLines.isEmpty ? extractBoundedLogRingLines(from: snapshotJSON) : ringLines
    if !effectiveRingLines.isEmpty {
      var seen = Set<String>()
      for chunk in chunks {
        for sub in String(decoding: chunk, as: UTF8.self).split(separator: "\n") {
          seen.insert(String(sub))
        }
      }
      let extra = effectiveRingLines.filter { !$0.isEmpty && seen.insert($0).inserted }
      if !extra.isEmpty {
        chunks.append(Data((extra.joined(separator: "\n") + "\n").utf8))
      }
    }
    guard !chunks.isEmpty else { return nil }
    return joinAndCapTail(chunks, maxBytes: DiagnosticsBundleBuilder.maxCombinedLogTailBytes)
  }

  static func collectComputerDriverTail(dataDir: URL?) -> Data? {
    guard let dataDir else { return nil }
    let file = dataDir.appending(
      path: "computer/atd-computer-driver.log", directoryHint: .notDirectory)
    return DiagnosticsBundleBuilder.readTailSlice(
      of: file, maxBytes: DiagnosticsBundleBuilder.computerDriverTailBytes,
      dataDirectoryURL: dataDir)
  }

  static func collectBrowserWorkersTail(dataDir: URL?) -> Data? {
    guard let dataDir else { return nil }
    let dir = dataDir.appending(path: "computer/browser-workers", directoryHint: .isDirectory)
    guard !DiagnosticsPathPolicy.isHardExcludedSource(dir, dataDirectoryURL: dataDir),
      let files = try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
        options: [.skipsHiddenFiles])
    else { return nil }

    let candidates: [(url: URL, mtime: Date)] = files.compactMap { url in
      guard url.pathExtension == "log",
        let vals = try? url.resourceValues(
          forKeys: [.contentModificationDateKey, .isRegularFileKey]),
        vals.isRegularFile == true
      else { return nil }
      return (url, vals.contentModificationDate ?? .distantPast)
    }
    let newestTwo = candidates.sorted { $0.mtime > $1.mtime }.prefix(2).reversed()
    var combined = Data()
    for item in newestTwo {
      guard
        let slice = DiagnosticsBundleBuilder.readTailSlice(
          of: item.url, maxBytes: DiagnosticsBundleBuilder.browserWorkerTailBytes,
          dataDirectoryURL: dataDir),
        !slice.isEmpty
      else { continue }
      let stem = item.url.deletingPathExtension().lastPathComponent
      let digest = SHA256.hash(data: Data(stem.utf8)).prefix(4).map { String(format: "%02x", $0) }
        .joined()
      combined.append(contentsOf: "=== profile-\(digest) ===\n".utf8)
      combined.append(slice)
      if combined.last != 0x0A { combined.append(0x0A) }
    }
    guard !combined.isEmpty else { return nil }
    return joinAndCapTail([combined], maxBytes: DiagnosticsBundleBuilder.browserWorkerTailBytes * 2)
  }

  static func writeChunked64KiB(_ data: Data, to fileURL: URL) throws {
    let fm = FileManager.default
    try fm.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let path = fileURL.path(percentEncoded: false)
    let fd = Darwin.open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, mode_t(0o600))
    guard fd >= 0 else { throw ScrubberAbortReason.scrubberException }
    defer { _ = Darwin.close(fd) }

    var offset = 0
    while offset < data.count {
      let end = min(offset + DiagnosticsBundleBuilder.streamChunkBytes, data.count)
      try autoreleasepool {
        let slice = data.subdata(in: offset..<end)
        try slice.withUnsafeBytes { ptr in
          guard let base = ptr.baseAddress else { return }
          var written = 0
          while written < ptr.count {
            let rc = Darwin.write(fd, base.advanced(by: written), ptr.count - written)
            if rc > 0 {
              written += rc
            } else if rc < 0 && errno == EINTR {
              continue
            } else {
              throw ScrubberAbortReason.scrubberException
            }
          }
        }
      }
      offset = end
    }
  }

  static func runDittoZip(sourceDirectory: URL, outputZip: URL) throws {
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/ditto")
    process.arguments = [
      "-c", "-k", "--norsrc", "--noextattr", "--keepParent",
      sourceDirectory.path(percentEncoded: false),
      outputZip.path(percentEncoded: false),
    ]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    let done = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in done.signal() }
    try process.run()
    if done.wait(timeout: .now() + .seconds(2)) == .timedOut {
      process.terminate()
      throw ScrubberAbortReason.cpuBudgetExceeded
    }
    guard process.terminationStatus == 0 else {
      throw ScrubberAbortReason.scrubberException
    }
  }

  static func extractSubobjectJSON(from rootData: Data?, key: String) -> Data? {
    guard let rootData,
      let root = (try? JSONSerialization.jsonObject(with: rootData)) as? [String: Any],
      let sub = root[key],
      JSONSerialization.isValidJSONObject(sub)
    else { return nil }
    return try? JSONSerialization.data(withJSONObject: sub, options: [.sortedKeys])
  }

  private static func extractBoundedLogRingLines(from rootData: Data?) -> [String] {
    guard let rootData,
      let root = (try? JSONSerialization.jsonObject(with: rootData)) as? [String: Any],
      let ring = root["boundedLogRing"] as? [String: Any],
      let lines = ring["lines"] as? [String]
    else { return [] }
    return lines
  }

  private static func joinAndCapTail(_ chunks: [Data], maxBytes: Int) -> Data {
    var out = Data()
    for chunk in chunks where !chunk.isEmpty {
      if !out.isEmpty && out.last != 0x0A { out.append(0x0A) }
      out.append(chunk)
    }
    guard out.count > maxBytes else { return out }
    let tail = out.suffix(maxBytes)
    if let nl = tail.prefix(min(4_096, tail.count)).firstIndex(of: 0x0A),
      tail.index(after: nl) < tail.endIndex
    {
      return Data(tail[tail.index(after: nl)...])
    }
    return Data(tail)
  }
}
