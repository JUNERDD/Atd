/// What the recording's island contents ask the presenter or orchestrator to perform, through
/// one closure (``IslandRecording/onEvent`` in the shell). Playback, trim, zoom and answer
/// paging stay in the card; export and ask events carry the state their external work needs.
public enum IslandRecordingEvent: Equatable, Sendable {
  // The recording capsule.
  /// The microphone toggle: off while it records, else on with the last one used.
  case micToggle
  case pause
  case resume
  /// The capsule's discard button: the orchestrator pauses and shows the confirmation.
  case discard
  /// The capsule's Stop.
  case stop

  // The discard confirmation.
  case confirmDiscard
  /// "Keep Recording": back to the capsule, resuming if the discard paused it.
  case keepRecording

  // The result card.
  /// Run this ask on the kept range and report its answer by id (`recording.ask`).
  case ask(RecordingAsk)
  /// Stop the ask with this id (`recording.askStop`); the card has already applied the stop
  /// rules.
  case stopAnswer(String)
  /// Regenerate: run this ask in place of `replacing` (the card shows it on the same page).
  case regenerate(RecordingAsk)
  /// "Open in Atd": hand the task of this ask to the panel (`recording.askOpen`).
  case openAnswer(String)
  /// Footer actions, each on the range kept now.
  case save(RecordingTrim)
  case copy(RecordingTrim)
  case attach(RecordingTrim)
  /// The card went: its close button, Escape with nothing left to end first, or a shortcut
  /// pressed while it had the keyboard. An answer still coming was stopped first
  /// (``stopAnswer(_:)``); the card's state stays with the recording for a later show.
  case close
}
