/// The screen recording's own words around its engine and its island surfaces: the status menu's
/// way back to the last recording, and the short notes the island shows after a save or a copy,
/// or when a recording cannot start or use a microphone. Folder names are runtime data.
public enum RecordingOrchestrationStringKey: String, CaseIterable, Sendable {
  case showLast = "recording.orch.showLast"
  case saved = "recording.orch.saved"
  case attached = "recording.orch.attached"
  case answerInterrupted = "recording.orch.answerInterrupted"
  case copied = "recording.orch.copied"
  case clipboardBusy = "recording.orch.clipboardBusy"
  case screenBusy = "recording.orch.screenBusy"
  case noMicrophone = "recording.orch.noMicrophone"
}
