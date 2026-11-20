import Foundation

/// How one step ended.
public enum StepOutcome: Sendable, Equatable {
  /// It did what it does; `output` is what a later step can work on.
  case done(text: String, output: String?)
  /// The person passed on it, or it had nothing to do.
  case skipped(text: String)
  /// It could not be done; the run goes on with the next step.
  case failed(text: String)
}

/// The run's moves from step to step. Each one applies only where the run is when it is asked
/// for and returns false otherwise, so an intent delivered twice, a button tapped twice or a step
/// that finishes after the run moved on changes nothing.
extension AutomationRun {
  /// A run of `automation` about to take its first step; `waiting` is each step's row before it
  /// runs.
  public init(
    id: UUID = UUID(), automation: Automation, source: RunSource, at now: Date,
    waiting: (AutomationStep) -> String
  ) {
    self.init(
      id: id, automationID: automation.id, source: source, startedAt: now, updatedAt: now,
      phase: automation.steps.isEmpty ? .finished : .running(step: 0), plan: automation.steps,
      steps: automation.steps.map { StepRecord(status: .waiting, text: waiting($0)) },
      activityID: nil)
  }

  /// The step the run is at: the one being performed, waiting for the person, or where it
  /// stopped.
  public var currentStep: Int? {
    switch phase {
    case .running(let step), .awaiting(let step), .interrupted(let step): step
    case .finished: nil
    }
  }

  /// Whether the run is still going: performing a step or waiting for the person.
  public var isLive: Bool {
    switch phase {
    case .running, .awaiting: true
    case .interrupted, .finished: false
    }
  }

  /// How many steps could not be done.
  public var failures: Int {
    steps.count(where: { $0.status == .failed })
  }

  /// The latest output of a step before `index`, which the step at `index` works on.
  public func input(for index: Int) -> String? {
    steps.prefix(index).last { $0.status == .done && $0.output != nil }?.output
  }

  /// What the run found: every step's output, in order. The Shortcuts action returns it, so
  /// 朗读文本 can read it aloud.
  public var result: String? {
    let outputs = steps.compactMap(\.output).filter { !$0.isEmpty }
    return outputs.isEmpty ? nil : outputs.joined(separator: "\n")
  }

  /// Starts performing the step at `index`, which the run is about to take.
  public mutating func start(_ index: Int, text: String, at now: Date) -> Bool {
    guard phase == .running(step: index), steps[index].status == .waiting else { return false }
    steps[index] = StepRecord(status: .running, text: text)
    updatedAt = now
    return true
  }

  /// Stops at the step at `index`, which the run is about to take, until the person approves it
  /// or passes on it. `ask` is what the person is asked.
  public mutating func wait(_ index: Int, ask: String, at now: Date) -> Bool {
    guard phase == .running(step: index), steps[index].status == .waiting else { return false }
    phase = .awaiting(step: index)
    steps[index].text = ask
    updatedAt = now
    return true
  }

  /// Records how the step at `index` ended, and moves on to the next step or finishes.
  public mutating func finish(_ index: Int, _ outcome: StepOutcome, at now: Date) -> Bool {
    switch phase {
    case .running(step: index) where steps[index].status == .running, .awaiting(step: index):
      break
    default:
      return false
    }
    switch outcome {
    case .done(let text, let output):
      steps[index] = StepRecord(status: .done, text: text, output: output)
    case .skipped(let text): steps[index] = StepRecord(status: .skipped, text: text)
    case .failed(let text): steps[index] = StepRecord(status: .failed, text: text)
    }
    phase = index + 1 < plan.count ? .running(step: index + 1) : .finished
    updatedAt = now
    return true
  }

  /// Stops at the step being performed, which goes back to waiting (`text`), so 继续 can run it
  /// again.
  public mutating func interrupt(text: String, at now: Date) -> Bool {
    guard case .running(let index) = phase else { return false }
    phase = .interrupted(step: index)
    steps[index] = StepRecord(status: .waiting, text: text)
    updatedAt = now
    return true
  }

  /// Picks an interrupted run up again from the step where it stopped, with a new Live Activity.
  public mutating func resume(at now: Date) -> Bool {
    guard case .interrupted(let index) = phase else { return false }
    phase = .running(step: index)
    activityID = nil
    updatedAt = now
    return true
  }
}
