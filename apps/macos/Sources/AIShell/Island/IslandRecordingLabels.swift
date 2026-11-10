import AICore
import Foundation

/// The recording's copy on the island in the shell language (``IslandLabels/recording``), built
/// again when it changes. Formatted copy is built per use, since its values (times, devices,
/// folders) change while the copy does not.
struct IslandRecordingLabels: Equatable {
  var recording = ""
  var paused = ""
  var micOnDefault = ""
  var pause = ""
  var resume = ""
  var discard = ""
  var stop = ""
  var stopRecording = ""
  var keepRecording = ""
  var confirmDiscard = ""
  var processing = ""
  var title = ""
  var restore = ""
  var restoreTooltip = ""
  var play = ""
  var playerHint = ""
  var fullScreen = ""
  var fullScreenTooltip = ""
  var steps = ""
  var stepsInfo = ""
  var noNarration = ""
  var noNarrationTooltip = ""
  var noSteps = ""
  var stepOutside = ""
  var trimStart = ""
  var trimEnd = ""
  var timeline = ""
  /// The full screen preview's (``IslandRecordingLightbox``).
  var lightbox = ""
  var lightboxPlayerHint = ""
  var lightboxSteps = ""
  var lightboxStepsTooltip = ""
  var lightboxBack = ""
  var lightboxBackTooltip = ""
  var lightboxHintPlay = ""
  var lightboxHintSeek = ""
  var lightboxHintTrim = ""
  var lightboxHintBack = ""
  var save = ""
  var saveTooltip = ""
  var copy = ""
  var copyTooltip = ""
  var attach = ""
  var attachTooltip = ""
  var actionWorking = ""
  /// The ask field's and answer slot's copy, with the recording's quick asks.
  var asking = IslandAskLabels<RecordingQuickAsk>()

  static func current() -> IslandRecordingLabels {
    let text: (RecordingIslandStringKey) -> String = { ShellStrings.shared.text($0) }
    return IslandRecordingLabels(
      recording: text(.recording), paused: text(.paused), micOnDefault: text(.micOnDefault),
      pause: text(.pause), resume: text(.resume), discard: text(.discard), stop: text(.stop),
      stopRecording: text(.stopRecording), keepRecording: text(.keepRecording),
      confirmDiscard: text(.confirmDiscard), processing: text(.processing), title: text(.title),
      restore: text(.restore), restoreTooltip: text(.restoreTooltip), play: text(.play),
      playerHint: text(.playerHint), fullScreen: text(.fullScreen),
      fullScreenTooltip: text(.fullScreenTooltip), steps: text(.steps),
      stepsInfo: text(.stepsInfo), noNarration: text(.noNarration),
      noNarrationTooltip: text(.noNarrationTooltip), noSteps: text(.noSteps),
      stepOutside: text(.stepOutside), trimStart: text(.trimStart), trimEnd: text(.trimEnd),
      timeline: text(.timeline), lightbox: text(.lightbox),
      lightboxPlayerHint: text(.lightboxPlayerHint), lightboxSteps: text(.lightboxSteps),
      lightboxStepsTooltip: text(.lightboxStepsTooltip), lightboxBack: text(.lightboxBack),
      lightboxBackTooltip: text(.lightboxBackTooltip), lightboxHintPlay: text(.lightboxHintPlay),
      lightboxHintSeek: text(.lightboxHintSeek), lightboxHintTrim: text(.lightboxHintTrim),
      lightboxHintBack: text(.lightboxHintBack), save: text(.save), saveTooltip: text(.saveTooltip),
      copy: text(.copy), copyTooltip: text(.copyTooltip), attach: text(.attach),
      attachTooltip: text(.attachTooltip), actionWorking: text(.actionWorking),
      asking: .current(
        placeholder: text(.askPlaceholder), label: text(.askLabel), question: text(.askDefault),
        quickAsks: [
          .reproductionSteps: text(.quickSteps), .summary: text(.quickSummary),
          .automation: text(.quickAutomation),
        ]))
  }

  /// The microphone toggle's tooltip and VoiceOver name for `capsule`.
  func microphone(_ capsule: RecordingCapsule) -> String {
    if let device = capsule.microphone { return Self.format(.micOff, device) }
    return capsule.lastMicrophone.map { Self.format(.micOn, $0) } ?? micOnDefault
  }

  /// The capsule for VoiceOver, with its time.
  func capsule(_ time: String) -> String { Self.format(.capsule, time) }

  func discardQuestion(_ time: String) -> String { Self.format(.discardQuestion, time) }

  func card(_ duration: String) -> String { Self.format(.card, duration) }

  /// The title row's duration once trimmed: the kept length and the whole.
  func trimmed(kept: String, whole: String) -> String { Self.format(.trimmed, kept, whole) }

  /// Save's tooltip, naming the folder when it is known.
  func save(to folder: String?) -> String { folder.map { Self.format(.saveTo, $0) } ?? saveTooltip }

  private static func format(_ key: RecordingIslandStringKey, _ arguments: String...) -> String {
    let strings = ShellStrings.shared
    return String(
      format: strings.text(key), locale: Locale(identifier: strings.language.rawValue),
      arguments: arguments)
  }
}
