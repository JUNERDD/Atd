import Foundation

/// Maps a normalized asset path to a regular file inside the renderer bundle. Normalization
/// already rules out separators and dot segments; this adds the file-system half of the
/// guarantee: symbolic links are resolved, and the result must still lie under the root.
public struct StaticFileResolver: Sendable {
  /// The bundle root, with its own symbolic links resolved.
  public let root: URL
  /// Served for the root path `/`.
  public static let indexFile = "index.html"

  public init(root: URL) {
    self.root = root.standardizedFileURL.resolvingSymlinksInPath()
  }

  /// The file to serve, or nil for a 404: hidden names, directories, missing files and
  /// anything whose resolved location leaves the root.
  public func resolve(_ path: NormalizedPath) -> URL? {
    let segments = path.segments.isEmpty ? [Self.indexFile] : path.segments
    guard !segments.contains(where: { $0.hasPrefix(".") }) else { return nil }
    var candidate = root
    for segment in segments {
      candidate.append(path: segment, directoryHint: .notDirectory)
    }
    let resolved = candidate.resolvingSymlinksInPath()
    let rootComponents = root.pathComponents
    guard resolved.pathComponents.count > rootComponents.count,
      Array(resolved.pathComponents.prefix(rootComponents.count)) == rootComponents,
      (try? resolved.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true
    else { return nil }
    return resolved
  }
}
