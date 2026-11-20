import Foundation

/// What 运行自动化 says (Siri speaks it; a personal automation running immediately shows
/// nothing) and returns, in the app's language.
public struct AutomationReply: Equatable {
  /// One sentence about what happened.
  public let dialog: String
  /// What the run found, for the next action in the shortcut (朗读文本); the dialog when it
  /// found nothing.
  public let value: String

  public init(_ outcome: TriggerOutcome) {
    switch outcome {
    case .ran(let automation, let run):
      let dialog = Self.dialog(automation.name, run)
      self.init(dialog: dialog, value: run.phase == .finished ? run.result ?? dialog : dialog)
    case .disabled(let automation):
      self.init(StepText.text("reply.disabled \(automation.name)"))
    case .alreadyRunning(let automation):
      self.init(StepText.text("reply.alreadyRunning \(automation.name)"))
    case .focusStarted(let session):
      self.init(StepText.text("reply.focusStarted \(session.label)"))
    case .focusEnded(let session):
      let time = FocusTime.text(session.duration ?? .zero)
      self.init(StepText.text("reply.focusEnded \(time)"))
    case .missing:
      self.init(StepText.text("reply.missing"))
    }
  }

  private init(dialog: String, value: String) {
    self.dialog = dialog
    self.value = value
  }

  private init(_ text: String) {
    self.init(dialog: text, value: text)
  }

  private static func dialog(_ name: String, _ run: AutomationRun) -> String {
    switch run.phase {
    case .finished where run.failures == 1:
      StepText.text("reply.finished.failure \(name)")
    case .finished where run.failures > 1:
      StepText.text("reply.finished.failures \(name) \(run.failures)")
    case .finished:
      StepText.text("reply.finished \(name)")
    case .awaiting(let step):
      StepText.text("reply.awaiting \(name) \(run.steps[step].text)")
    case .interrupted, .running:
      StepText.text("reply.interrupted \(name)")
    }
  }
}
