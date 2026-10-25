import AICore
import CoreGraphics
import Foundation
import Synchronization
import Vision

/// Text recognition for the screen-context attachment (decision F1): Vision's accurate
/// recognizer over the raw selection (annotations would only add noise), with language
/// correction and automatic language detection over Simplified and Traditional Chinese and
/// English. Recognition never holds a capture up for long: past ``timeout`` the capture goes on
/// without text.
nonisolated enum ScreenText {
  static let timeout = Duration.seconds(3)
  static let languages = ["zh-Hans", "zh-Hant", "en-US"].map { Locale.Language(identifier: $0) }

  /// The text in `image` in reading order, or no lines when recognition fails or runs past
  /// `timeout`. The work runs off the main actor; a timed-out request is cancelled and its late
  /// answer dropped.
  static func lines(in image: CGImage, timeout: Duration = timeout) async -> [String] {
    ScreenContext.readingOrder(await boxes(in: image, timeout: timeout) ?? [])
  }

  /// The pieces of text in `image` with their boxes (normalized, top-left origin) and
  /// confidence, at most `limit` of them in the recognizer's order; nil when recognition failed
  /// or ran past `timeout`, so a caller can tell "no text" from "no answer".
  static func boxes(in image: CGImage, timeout: Duration = timeout, limit: Int = .max) async
    -> [ScreenContext.TextBox]?
  {
    let gate = ResumeGate()
    return await withCheckedContinuation { continuation in
      let work = Task.detached(priority: .userInitiated) {
        let boxes = await recognize(image).map { Array($0.prefix(limit)) }
        if gate.claim() { continuation.resume(returning: boxes) }
      }
      Task.detached {
        try? await Task.sleep(for: timeout)
        work.cancel()
        if gate.claim() { continuation.resume(returning: nil) }
      }
    }
  }

  @concurrent
  private static func recognize(_ image: CGImage) async -> [ScreenContext.TextBox]? {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages
    guard let observations = try? await request.perform(on: image) else { return nil }
    return observations.compactMap { observation -> ScreenContext.TextBox? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      // Vision's normalized boxes have their origin at the bottom-left.
      let box = observation.boundingBox.cgRect
      return ScreenContext.TextBox(
        text: candidate.string,
        box: CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height),
        confidence: Double(candidate.confidence))
    }
  }
}

/// Lets exactly one of two racing tasks resume a continuation.
private nonisolated final class ResumeGate: Sendable {
  private let claimed = Mutex(false)

  /// True for the first caller only.
  func claim() -> Bool {
    claimed.withLock { claimed in
      defer { claimed = true }
      return !claimed
    }
  }
}
