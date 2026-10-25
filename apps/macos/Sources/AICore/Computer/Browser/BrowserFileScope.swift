import Foundation

/// The files a browser target may touch on disk (contract v1.3 B3, B4), checked by real path, so
/// a symlink or `..` can never point outside:
///
/// - an `upload` sets only regular files of at most ``ComputerWireLimits/maxUploadBytes`` inside
///   the service's task resource store (`<dataDir>/resources/`), whose paths the service filled in
///   after checking the resources belong to the run's task;
/// - a download counts only as a regular file inside the run's download directory
///   (`<dataDir>/computer/downloads/<runId>/`), which the host creates and names to the worker.
///
/// The worker checks the same roots again before it sets or saves anything.
public enum BrowserFileScope {
  /// Why the host refuses an upload before anything is sent.
  public struct Refusal: Error, Equatable, Sendable {
    public let message: String

    init(_ message: String) { self.message = message }
  }

  /// The directory `runId`'s downloads are saved in, or nil when the id cannot name one.
  public static func runDirectory(_ root: URL, runId: String) -> URL? {
    guard (1...128).contains(runId.count),
      BridgeCoding.matches(runId, ComputerPattern.identifier)
    else { return nil }
    return root.appending(path: runId, directoryHint: .isDirectory)
  }

  /// The real paths of an upload's files, in the order of `resourceIds`.
  public static func uploadFiles(
    _ paths: [String]?, resourceIds: [String], root: URL,
    maxBytes: Int = ComputerWireLimits.maxUploadBytes
  ) throws(Refusal) -> [String] {
    guard let paths, !paths.isEmpty else {
      throw Refusal("The upload names no files; only the service fills them in.")
    }
    guard paths.count == resourceIds.count else {
      throw Refusal("The upload names \(paths.count) files for \(resourceIds.count) resources.")
    }
    guard let realRoot = realPath(root.path(percentEncoded: false)) else {
      throw Refusal("The task resource store does not exist.")
    }
    var files: [String] = []
    for path in paths {
      guard let real = realPath(path), real.hasPrefix(realRoot + "/") else {
        throw Refusal("A file of the upload is outside the task resource store.")
      }
      guard let size = regularFileSize(real) else {
        throw Refusal("A file of the upload is not a regular file.")
      }
      guard size <= maxBytes else {
        throw Refusal("A file of the upload is larger than \(maxBytes / 1_048_576) MB.")
      }
      files.append(real)
    }
    return files
  }

  /// A download the worker reported, as the result carries it: nil unless its real path is a
  /// regular file inside `directory`. The size is the file's own, not the reported one.
  public static func download(_ reported: BrowserWorkerReply.Download, in directory: URL)
    -> ComputerDownloadWire?
  {
    guard let realDirectory = realPath(directory.path(percentEncoded: false)),
      let real = realPath(reported.path), real.hasPrefix(realDirectory + "/"),
      real.count <= 4096, let size = regularFileSize(real)
    else { return nil }
    let named = reported.name.trimmingCharacters(in: .whitespacesAndNewlines)
    let name = named.isEmpty ? URL(filePath: real).lastPathComponent : named
    let mime = reported.mime.flatMap { $0.isEmpty ? nil : $0 }
    return ComputerDownloadWire(name: name, path: real, bytes: size, mime: mime)
  }

  /// `realpath(3)`: the absolute path with every symlink, `.` and `..` resolved; nil when the
  /// file does not exist. Foundation's `resolvingSymlinksInPath` can drop `/private`, so it
  /// would not compare with a root resolved the same way.
  static func realPath(_ path: String) -> String? {
    guard let resolved = realpath(path, nil) else { return nil }
    defer { free(resolved) }
    return String(cString: resolved)
  }

  /// The size of the regular file at `path` (not following a final symlink), or nil.
  static func regularFileSize(_ path: String) -> Int? {
    var info = stat()
    guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return nil }
    return Int(info.st_size)
  }
}
