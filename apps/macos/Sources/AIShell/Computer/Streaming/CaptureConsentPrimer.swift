import AICore
import AppKit
import OSLog
// Weakly linked like every other ScreenCaptureKit user here: the SDK leaves classes behind its
// macOS 26 API unmarked; this file reaches only API that exists on macOS 15.
@_weakLinked import ScreenCaptureKit

/// Prepares screen-capture consent ahead of any task (plan §8.3, A3-11). Since macOS 15 a direct
/// screen capture can bring up the system's consent alert, which would take focus in the middle of
/// a run. Only the person's click in Settings (`computer.primeCaptureConsent`) runs ``prime()``:
/// one 16 × 16 ScreenCaptureKit capture of a corner of the main display — a display, not Atd's own
/// window, which the system exempts — so the alert, if any, appears while the person is there to
/// answer it, and this app's record (``CaptureConsentRecord``) says it is prepared. No run,
/// observation, preview, share or automation calls it.
///
/// The coordinator reads ``record``: an unattended operation that needs a direct capture of a
/// native target (a screenshot, a preview stream, an off-Space capture) fails `needsConsent`
/// without it and never prompts; attended ones capture as before.
final class CaptureConsentPrimer {
  enum Outcome: Equatable {
    /// Prepared, at the record's time.
    case prepared(primedAt: String)
    /// macOS refused the capture: Screen Recording is not granted to this build, or the person
    /// declined the alert. Any earlier record stays as it is.
    case denied
    /// The capture could not be tried: no display to capture, or it failed for another reason.
    case unavailable
  }

  private let file: URL
  private let bundleId: String
  /// This app's record, read once and replaced by each successful preparation.
  private(set) var record: CaptureConsentRecord?
  /// The preparation in flight, which a second request joins.
  private var running: Task<Outcome, Never>?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  /// Keeps this app's record among the computer host's files in `directory`
  /// (``ComputerHostLock``).
  init(directory: URL, bundleId: String) {
    let records = directory.appending(
      path: CaptureConsentRecord.directoryName, directoryHint: .isDirectory)
    file = records.appending(path: CaptureConsentRecord.fileName(for: bundleId))
    self.bundleId = bundleId
    record = CaptureConsentRecord.decoding(try? Data(contentsOf: file), bundleId: bundleId)
  }

  var isPrepared: Bool { record != nil }

  func prime() async -> Outcome {
    if let running { return await running.value }
    let task = Task { await self.capture() }
    running = task
    let outcome = await task.value
    running = nil
    return outcome
  }

  private func capture() async -> Outcome {
    guard CGPreflightScreenCaptureAccess() else { return .denied }
    do {
      guard try await Self.captureDisplayCorner() else { return .unavailable }
    } catch {
      if (error as? SCStreamError)?.code == .userDeclined { return .denied }
      Self.log.error("Capture consent was not prepared: \(error, privacy: .public)")
      return .unavailable
    }
    let prepared = CaptureConsentRecord(bundleId: bundleId, primedAt: Date())
    do {
      try FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
      try JSONEncoder().encode(prepared).write(to: file, options: .atomic)
    } catch {
      Self.log.error("The capture consent record could not be written: \(error, privacy: .public)")
      return .unavailable
    }
    record = prepared
    return .prepared(primedAt: prepared.primedAt)
  }

  /// One 16 × 16 capture of the main display's top-left corner, without the cursor; the image
  /// itself is discarded. False when there is no display to capture.
  private static func captureDisplayCorner() async throws -> Bool {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: true)
    guard
      let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
        ?? content.displays.first
    else { return false }
    let configuration = SCStreamConfiguration()
    configuration.width = 16
    configuration.height = 16
    configuration.sourceRect = CGRect(x: 0, y: 0, width: 16, height: 16)
    configuration.showsCursor = false
    _ = try await SCScreenshotManager.captureImage(
      contentFilter: SCContentFilter(display: display, excludingWindows: []),
      configuration: configuration)
    return true
  }
}
