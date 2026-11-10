import AICore
import CoreGraphics
import Foundation
import Synchronization
import Vision

/// Text recognition for captures (decision F1, architecture S5): Vision's accurate recognizer
/// over the raw selection (annotations would only add noise), with language correction and
/// automatic language detection over Simplified and Traditional Chinese and English. The raw
/// selection still shows what the capture's mosaics hide, so the screen-context attachment cuts
/// what they cover (``ScreenContext/init(app:window:element:recognized:hiding:)``).
/// ``boxes(in:timeout:limit:)`` reads text only, for that attachment and for computer use;
/// ``scan(in:timeout:)`` also finds the sensitive parts, which only auto-redact uses, so no other
/// caller spends its bound on them. Recognition never holds a capture up for long: past
/// ``timeout`` the capture goes on without text.
nonisolated enum ScreenText {
  static let timeout = Duration.seconds(3)
  static let languages = ["zh-Hans", "zh-Hant", "en-US"].map { Locale.Language(identifier: $0) }

  /// The pieces of text in `image` with their boxes (normalized, top-left origin) and
  /// confidence, at most `limit` of them in the recognizer's order; nil when recognition failed
  /// or ran past `timeout`, so a caller can tell "no text" from "no answer". The work runs off
  /// the main actor; a timed-out request is cancelled and its late answer dropped.
  static func boxes(in image: CGImage, timeout: Duration = timeout, limit: Int = .max) async
    -> [ScreenContext.TextBox]?
  {
    await bounded(by: timeout) {
      await recognize(image).map { lines in Array(lines.prefix(limit).map(\.box)) }
    }
  }

  /// What a selection being edited shows (architecture S5, S6): every piece of text, and the
  /// parts of it that look sensitive (``SensitiveText``), each boxed on its own rather than as
  /// its whole line where the recognizer can say where it is. Boxes are normalized with the
  /// origin at the top-left.
  struct Scan: Sendable {
    let boxes: [ScreenContext.TextBox]
    let sensitive: [SensitiveText.Box]
  }

  /// `image`'s ``Scan``; nil when recognition failed or ran past `timeout`. Cancelling the
  /// calling task stops the recognition and answers nil at once.
  static func scan(in image: CGImage, timeout: Duration) async -> Scan? {
    await bounded(by: timeout) {
      await recognize(image).map { lines in
        Scan(boxes: lines.map(\.box), sensitive: lines.flatMap(sensitiveParts))
      }
    }
  }

  /// One recognized piece: its box, and the recognizer's reading, which can box any part of it.
  private struct Line: Sendable {
    let box: ScreenContext.TextBox
    let reading: RecognizedText
  }

  /// `work`'s answer, or nil once `timeout` passed first or the calling task was cancelled; the
  /// work is cancelled then and its late answer dropped.
  private static func bounded<Value: Sendable>(
    by timeout: Duration, _ work: @escaping @Sendable () async -> Value?
  ) async -> Value? {
    let race = Race<Value>()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        race.begin(continuation)
        race.attach(Task.detached(priority: .userInitiated) { race.finish(await work()) })
        Task.detached {
          try? await Task.sleep(for: timeout)
          race.finish(nil)
        }
      }
    } onCancel: {
      race.finish(nil)
    }
  }

  @concurrent
  private static func recognize(_ image: CGImage) async -> [Line]? {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages
    guard let observations = try? await request.perform(on: image) else { return nil }
    return observations.compactMap { observation -> Line? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let box = ScreenContext.TextBox(
        text: candidate.string, box: flipped(observation.boundingBox.cgRect),
        confidence: Double(candidate.confidence))
      return Line(box: box, reading: candidate)
    }
  }

  /// The sensitive parts of `line` (``SensitiveText``), each in its own box where the recognizer
  /// can give one, else in the line's.
  private static func sensitiveParts(of line: Line) -> [SensitiveText.Box] {
    let text = line.reading.string
    return SensitiveText.matches(in: text).map { match in
      let part = line.reading.boundingBox(for: match.range).map { flipped($0.boundingBox.cgRect) }
      return SensitiveText.Box(kind: match.kind, box: part ?? line.box.box)
    }
  }

  /// A Vision box (normalized, origin at the bottom-left) with the origin at the top-left.
  private static func flipped(_ box: CGRect) -> CGRect {
    CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
  }
}

/// One bounded recognition: the first of its answer, its timeout and its caller's cancellation
/// resumes the caller and cancels the work; the others find it finished. Cancellation can come
/// before the caller is suspended, so whichever of the two arrives second does the resuming.
private nonisolated final class Race<Value: Sendable>: Sendable {
  private struct State {
    var continuation: CheckedContinuation<Value?, Never>?
    var work: Task<Void, Never>?
    var finished = false
  }

  private let state = Mutex(State())

  func begin(_ continuation: CheckedContinuation<Value?, Never>) {
    let finished = state.withLock { state in
      if !state.finished { state.continuation = continuation }
      return state.finished
    }
    if finished { continuation.resume(returning: nil) }
  }

  func attach(_ work: Task<Void, Never>) {
    let finished = state.withLock { state in
      if !state.finished { state.work = work }
      return state.finished
    }
    if finished { work.cancel() }
  }

  func finish(_ value: Value?) {
    let taken = state.withLock { state -> State? in
      guard !state.finished else { return nil }
      let taken = state
      state = State(continuation: nil, work: nil, finished: true)
      return taken
    }
    taken?.work?.cancel()
    taken?.continuation?.resume(returning: value)
  }
}
