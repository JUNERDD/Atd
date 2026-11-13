import AICore
import AVFoundation
import AppKit

/// What asking about or attaching a range of a recording sends (decisions R11, B4, B5): key
/// frames and the context file, plus the movie when attaching. At most
/// ``AttachmentRules/maxPathsPerImport`` files.
struct RecordingExportFiles: Equatable, Sendable {
  /// The folder made for this export inside the take's folder; deleted with it.
  let folder: URL
  /// The key frames in time order, at most ``RecordingAttachmentRules/maxKeyframes``.
  let keyframes: [URL]
  let context: URL
  /// The movie of the range, for attaching: the take's own file when the range is all of it,
  /// else a trim or re-encode in ``folder``. Nil when asking, and when it would not fit.
  let movie: URL?
  /// The movie was left out because it is over the attachment limit even re-encoded; the
  /// context file says so too.
  let movieOmitted: Bool

  /// Every file in import order: the movie, the context, the key frames.
  var all: [URL] { (movie.map { [$0] } ?? []) + [context] + keyframes }
}

/// Exports a recording (decision R11): a trimmed movie, a copy saved to a folder, the files for
/// asking and attaching, and a copy for the pasteboard.
enum RecordingExporter {
  nonisolated enum Purpose: Sendable {
    /// Asking sends images and the context only: the model cannot watch video.
    case ask
    /// Attaching adds the movie, which the conversation keeps.
    case attach
  }

  /// Writes `range` of the result's movie to `destination` (which must not exist yet): a copy
  /// when the range is the whole take, else a trim of the samples, not re-encoded.
  static func trimmed(
    _ result: RecordingResult, range: ClosedRange<Double>, to destination: URL
  ) async throws(RecordingError) {
    do {
      if isWhole(range, of: result) {
        try await copy(result.movie, to: destination)
        return
      }
      guard
        let export = AVAssetExportSession(
          asset: AVURLAsset(url: result.movie), presetName: AVAssetExportPresetPassthrough)
      else { throw RecordingError.exportFailed("The recording could not be trimmed.") }
      export.timeRange = timeRange(range, of: result)
      try await export.export(to: destination, as: .mp4)
    } catch let error as RecordingError {
      throw error
    } catch {
      throw .exportFailed(error.localizedDescription)
    }
  }

  /// Saves `range` into `folder` under the recording's name, made unique there
  /// (`… (2).mp4`), and answers the file. Writing to Desktop or Documents asks for the folder
  /// grant the first time; a refusal throws ``RecordingError/saveFailed(_:)``.
  static func save(_ result: RecordingResult, range: ClosedRange<Double>, to folder: URL)
    async throws(RecordingError) -> URL
  {
    let name = RecordingFileNames.unique(result.take.movieName) {
      FileManager.default.fileExists(atPath: folder.appending(path: $0).path)
    }
    let file = folder.appending(path: name)
    do throws(RecordingError) {
      try await trimmed(result, range: range, to: file)
    } catch {
      try? FileManager.default.removeItem(at: file)
      if case .exportFailed(let detail) = error { throw .saveFailed(detail) }
      throw error
    }
    return file
  }

  /// Saves `range` directly to `destination`, exporting to a sibling staging file first so
  /// overwriting an existing file chosen in `NSSavePanel` succeeds cleanly.
  static func save(_ result: RecordingResult, range: ClosedRange<Double>, toFile destination: URL)
    async throws(RecordingError) -> URL
  {
    let parent = destination.deletingLastPathComponent()
    let staging = parent.appending(path: ".\(UUID().uuidString).mp4")
    let fileManager = FileManager.default
    defer { try? fileManager.removeItem(at: staging) }
    do throws(RecordingError) {
      try await trimmed(result, range: range, to: staging)
    } catch {
      if case .exportFailed(let detail) = error { throw .saveFailed(detail) }
      throw error
    }
    do {
      if fileManager.fileExists(atPath: destination.path(percentEncoded: false)) {
        _ = try fileManager.replaceItemAt(destination, withItemAt: staging)
      } else {
        try fileManager.moveItem(at: staging, to: destination)
      }
    } catch {
      throw .saveFailed(error.localizedDescription)
    }
    return destination
  }

  /// A copy of `range` for the pasteboard, in a folder of its own in the temporary directory
  /// so it outlives the take: what is pasted is read after the card may be gone. The system
  /// clears it with the temporary directory.
  static func clipboardFile(for result: RecordingResult, range: ClosedRange<Double>)
    async throws(RecordingError) -> URL
  {
    let folder = URL.temporaryDirectory.appending(path: "recording-copy-\(UUID().uuidString)")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw .exportFailed(error.localizedDescription)
    }
    let file = folder.appending(path: result.take.movieName)
    try await trimmed(result, range: range, to: file)
    return file
  }

  /// What to write to the pasteboard for `file`, under the owner's clipboard claim
  /// (`DeviceArbiter.writeClipboard(as:_:)`): its file URL, which Finder pastes as a copy and
  /// other apps as an attachment.
  static func pasteboardWriters(for file: URL) -> [any NSPasteboardWriting] {
    [file as NSURL]
  }

  /// The files for asking about or attaching `range`: up to
  /// ``RecordingAttachmentRules/maxKeyframes`` key frames of it, its context file and, when
  /// attaching, its movie, trimmed and re-encoded down to fit
  /// ``RecordingAttachmentRules/maxMovieBytes`` or left out
  /// (``RecordingExportFiles/movieOmitted``).
  /// File preparation and failed-export cleanup must not wait behind unrelated UI work.
  @concurrent
  nonisolated static func files(
    for result: RecordingResult, range: ClosedRange<Double>, purpose: Purpose
  ) async throws(RecordingError) -> RecordingExportFiles {
    guard !Task.isCancelled else { throw .exportFailed("Export cancelled.") }
    let range = range.clamped(to: result.fullRange)
    let folder = result.take.folder.appending(path: "export-\(UUID().uuidString)")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw .exportFailed(error.localizedDescription)
    }
    // Until ownership reaches the caller, every failed or cancelled export removes only its
    // own folder; the original movie and other readers' exports remain intact.
    var completed = false
    defer { if !completed { try? FileManager.default.removeItem(at: folder) } }
    let times = RecordingKeyframePlan.select(
      result.keyframeTimes, in: range, limit: RecordingAttachmentRules.maxKeyframes)
    let frames = await RecordingKeyframes.write(
      times, from: result.movie, startedAt: result.take.startedAt, into: folder)
    guard !Task.isCancelled else { throw .exportFailed("Export cancelled.") }
    var movie: URL?
    var video = RecordingContext.Video.notSent
    if purpose == .attach {
      movie = try await attachableMovie(result, range: range, in: folder)
      video = movie.map { .attached($0.lastPathComponent) } ?? .tooLarge
    }
    guard !Task.isCancelled else { throw .exportFailed("Export cancelled.") }
    let context = RecordingContext(
      app: result.app, range: range, duration: result.duration,
      pixelWidth: result.take.pixelWidth, pixelHeight: result.take.pixelHeight,
      narration: result.narration, steps: RecordingSteps.kept(result.steps, in: range),
      keyframes: frames.map { .init(time: $0.time, fileName: $0.file.lastPathComponent) },
      video: video)
    let contextFile = folder.appending(
      path: RecordingFileNames.context(startedAt: result.take.startedAt))
    do {
      try Data(context.markdown.utf8).write(to: contextFile)
    } catch {
      throw .exportFailed(error.localizedDescription)
    }
    completed = true
    return RecordingExportFiles(
      folder: folder, keyframes: frames.map(\.file), context: contextFile, movie: movie,
      movieOmitted: purpose == .attach && movie == nil)
  }

  /// The movie of `range` within the limit: the take's file or a trim when its share of the
  /// take's bytes fits, else a re-encode; nil when even that does not fit.
  private static func attachableMovie(
    _ result: RecordingResult, range: ClosedRange<Double>, in folder: URL
  ) async throws(RecordingError) -> URL? {
    let limit = RecordingAttachmentRules.maxMovieBytes
    let destination = folder.appending(path: result.take.movieName)
    let share = (range.upperBound - range.lowerBound) / max(result.duration, 0.001)
    // Trimming keeps the bit rate, so the range's share of the file is its size, give or take
    // the sync frame before its start.
    if Double(bytes(of: result.movie)) * share <= Double(limit) * 0.95 {
      // The take's own file, unless it kept a working name: a copy (a clone on this volume)
      // then carries the recording's name.
      if isWhole(range, of: result), result.movie.lastPathComponent == result.take.movieName {
        return result.movie
      }
      try await trimmed(result, range: range, to: destination)
      if bytes(of: destination) <= limit { return destination }
      try? FileManager.default.removeItem(at: destination)
    }
    guard
      try await RecordingTranscoder.fit(
        result.movie, range: timeRange(range, of: result), to: destination)
    else { return nil }
    if bytes(of: destination) <= limit { return destination }
    try? FileManager.default.removeItem(at: destination)
    return nil
  }

  /// Copies `source` to `destination` away from the main actor: to another volume (a folder
  /// picked with "Other…") a long recording takes a while.
  @concurrent
  private nonisolated static func copy(_ source: URL, to destination: URL) async throws {
    try FileManager.default.copyItem(at: source, to: destination)
  }

  private static func isWhole(_ range: ClosedRange<Double>, of result: RecordingResult) -> Bool {
    range.lowerBound <= 0.05 && range.upperBound >= result.duration - 0.05
  }

  private static func timeRange(_ range: ClosedRange<Double>, of result: RecordingResult)
    -> CMTimeRange
  {
    let range = range.clamped(to: result.fullRange)
    return CMTimeRange(
      start: CMTime(seconds: range.lowerBound, preferredTimescale: 600),
      end: CMTime(seconds: range.upperBound, preferredTimescale: 600))
  }

  private static func bytes(of file: URL) -> Int {
    (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? .max
  }
}
