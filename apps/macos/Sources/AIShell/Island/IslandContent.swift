import AICore

/// The answer card's answer: its text, and whether more of it is still coming, which the card
/// follows and offers to stop rather than to copy or write.
struct IslandAnswer: Equatable {
  let text: String
  var streaming = false
}

/// What the command island shows.
enum IslandContent: Equatable {
  /// A command shortcut is down: the command's name and the charge toward its options card.
  case press(command: String)
  /// The run is going, with the values it runs with when it has options to change.
  case working(command: String, summary: String?)
  /// The options card (``IslandModel/card``) of the named command.
  case choose(command: String)
  case writing
  case done
  case notice(message: String)
  /// The answer card (``IslandAnswerCard``): a run's answer that could not be written, or that
  /// lands on the card and is still streaming in.
  case answer(command: String, answer: IslandAnswer, note: String?)
  /// The review card (``IslandReviewCard``, its draft in ``IslandModel/review``): an answer that
  /// waits for review, with its original, changes, versions and options.
  case review(command: String, answer: String, note: String?, review: CommandProgressState.Review)
  /// The answer card's answer went to the clipboard.
  case copied
  /// The compose card (``IslandComposeCard``, its draft in ``IslandModel/compose``) of the named
  /// command, launched with nothing selected; `attach` offers a screenshot or files.
  case compose(command: String, attach: Bool)
  /// The shell's screen recording (``IslandRecording``): its capsule, whose live values are
  /// ``IslandModel/recording``.
  case recording
  /// The recording, or the long screenshot, is being processed (`outcome` nil: a spinner), or one
  /// of the recording's results went somewhere (a check) or could not (a warning), in words.
  case recordingStatus(message: String, outcome: IslandRecording.StatusKind?)
  /// The capsule asks before it throws away the recording, `elapsed` long so far.
  case recordingDiscard(elapsed: String)
  /// The recording's result card (``IslandRecordingCard``, its state in
  /// ``IslandModel/recordingCard``).
  case recordingResult
  /// The long screenshot's result card (``IslandLongScreenshotCard``, its state in
  /// ``IslandModel/longScreenshotCard``).
  case longScreenshotResult

  /// Content of the same kind changes in place; another kind replaces it through a morph.
  enum Kind {
    case press, working, choose, writing, done, notice, answer, review, copied, compose
    case recording, recordingStatus, recordingDiscard, recordingResult, longScreenshotResult

    /// A card (the options card, the answer card, the review card, the compose card, the shell's
    /// result cards), with the card's corner rather than a capsule's.
    var isCard: Bool {
      [.choose, .answer, .review, .compose, .recordingResult, .longScreenshotResult].contains(self)
    }

    /// The shell's own content (the recording's, the long screenshot's), which reserves its
    /// display's work area as the canvas and reflows.
    var isShell: Bool {
      [.recording, .recordingStatus, .recordingDiscard, .recordingResult, .longScreenshotResult]
        .contains(self)
    }

    /// Reflow-capable content (the shell's, and the review card, which pages in place)
    /// reserves its presentation clock before the result is mounted.
    var layoutMotion: IslandLayoutMotion {
      isShell || self == .review ? .interpolated : .fixed
    }
  }

  /// A change of size within this content follows the person's own input or a stream rather
  /// than replacing what shows: the shape moves on the direct edits' spring and the content keeps
  /// its own size (``IslandChoreography/inPlace``), so text under the eye holds still.
  /// An answer streaming in grows the same way.
  var resizesInPlace: Bool {
    if case .answer(_, let answer, _) = self { return answer.streaming }
    return kind == .compose
  }

  var kind: Kind {
    switch self {
    case .press: .press
    case .working: .working
    case .choose: .choose
    case .writing: .writing
    case .done: .done
    case .notice: .notice
    case .answer: .answer
    case .review: .review
    case .copied: .copied
    case .compose: .compose
    case .recording: .recording
    case .recordingStatus: .recordingStatus
    case .recordingDiscard: .recordingDiscard
    case .recordingResult: .recordingResult
    case .longScreenshotResult: .longScreenshotResult
    }
  }
}
