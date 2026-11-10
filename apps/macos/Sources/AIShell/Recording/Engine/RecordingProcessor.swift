import AICore
import Foundation

/// Turns a take into a result (decision R11): narration from the microphone, the steps, and the
/// moments worth a key frame. Nothing here fails the recording: narration that cannot be had is
/// a reason in the result instead. Key frame images are made when files are exported
/// (``RecordingExporter``), for the range then kept.
enum RecordingProcessor {
  /// The result of `take`, which takes over its folder. Asks for the Speech Recognition grant
  /// the first time a take has microphone audio; `locale` is the language narration is heard in.
  static func process(
    _ take: RecordingTake, locale: Locale = RecordingTranscriber.preferredLocale
  ) async -> RecordingResult {
    let narration = await RecordingTranscriber.transcribe(take.microphone, locale: locale)
    let steps = RecordingSteps.make(
      events: take.events, changes: take.screenChanges, narration: narration.lines,
      duration: take.duration)
    return RecordingResult(
      take: take, app: take.appName, steps: steps,
      keyframeTimes: RecordingKeyframePlan.candidates(steps: steps, duration: take.duration),
      narration: narration)
  }
}
