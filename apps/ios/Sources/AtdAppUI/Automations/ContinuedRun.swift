import AtdAutomations
import BackgroundTasks
import UIKit

/// Keeps a run the person started in Atd (试一次, 继续, the steps after 发送) going when they
/// leave Atd while it still works.
///
/// It asks for a continued-processing task, which the system allows only for work the person
/// starts in front and shows with its own progress; the run reports each finished step to it,
/// and an expired task stops the run, which then waits for 继续. Where the system declines the
/// request (always in the simulator, or when it is busy), the run gets the ordinary few minutes
/// of background time instead. A run Shortcuts starts never comes here: it runs inside its App
/// Intent's own time.
final class ContinuedRun {
  private let task: Task<Void, Never>
  private let total: Int64
  private var processing: BGContinuedProcessingTask?
  private var background = UIBackgroundTaskIdentifier.invalid
  private var isDone = false

  /// Starts `work` now and keeps it going in the background until it returns; the object lives
  /// until then.
  /// - Parameter finished: called on the main actor once `work` returned.
  init(
    title: String, steps: Int, _ work: @escaping @Sendable () async -> Void,
    finished: @escaping (ContinuedRun) -> Void
  ) {
    total = Int64(max(steps, 1))
    let task = Task { await work() }
    self.task = task
    request(title: title)
    Task {
      await task.value
      isDone = true
      complete()
      finished(self)
    }
  }

  /// Shows how far the run got in the system's progress.
  func report(_ run: AutomationRun?) {
    guard let processing, let run else { return }
    processing.progress.completedUnitCount = Int64(
      run.steps.count(where: { $0.status != .waiting && $0.status != .running }))
    if let index = run.currentStep, run.steps.indices.contains(index) {
      processing.updateTitle(processing.title, subtitle: run.steps[index].text)
    }
  }

  private func request(title: String) {
    guard let bundle = Bundle.main.bundleIdentifier else { return holdBackgroundTime() }
    // One identifier per run under the prefix Info.plist permits, registered once.
    let identifier = "\(bundle).automation.\(UUID().uuidString)"
    let task = task
    // The handler runs on the main queue, where this object lives.
    let registered = BGTaskScheduler.shared.register(
      forTaskWithIdentifier: identifier, using: .main
    ) { [weak self] granted in
      guard let processing = granted as? BGContinuedProcessingTask else {
        granted.setTaskCompleted(success: false)
        return
      }
      processing.expirationHandler = { @Sendable in task.cancel() }
      self?.attach(processing)
    }
    let request = BGContinuedProcessingTaskRequest(
      identifier: identifier, title: title, subtitle: "")
    request.strategy = .fail
    do {
      guard registered else { throw CocoaError(.featureUnsupported) }
      try BGTaskScheduler.shared.submit(request)
    } catch {
      holdBackgroundTime()
    }
  }

  private func attach(_ processing: BGContinuedProcessingTask) {
    processing.progress.totalUnitCount = total
    self.processing = processing
    // The run may have ended before the system started the task.
    if isDone { complete() }
  }

  /// The few minutes iOS gives an app that just went to the background.
  private func holdBackgroundTime() {
    let task = task
    background = UIApplication.shared.beginBackgroundTask(withName: "automation") {
      task.cancel()
    }
  }

  private func complete() {
    processing?.progress.completedUnitCount = total
    processing?.setTaskCompleted(success: !task.isCancelled)
    processing = nil
    if background != .invalid {
      UIApplication.shared.endBackgroundTask(background)
      background = .invalid
    }
  }
}
