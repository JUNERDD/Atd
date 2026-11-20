import AtdModel
import Foundation

/// What the automations need while the app launches.
public enum AutomationLaunch {
  /// Called once while the app launches (`AtdAppLaunch`): puts the runs right with what happened
  /// while Atd was closed. Nothing registers with `BGTaskScheduler` here: the only background
  /// tasks are continued-processing tasks for runs the person starts, which may register when
  /// they start (AtdAppUI's `ContinuedRun`).
  @MainActor public static func prepare() {
    guard let engine = AutomationEngine.shared else { return }
    Task { await engine.reconcile() }
    #if DEBUG
      DebugLaunch.start(engine, arguments: ProcessInfo.processInfo.arguments)
    #endif
  }
}

#if DEBUG
  /// Launch arguments that stand in, in the simulator, for what simctl cannot do: Shortcuts
  /// running an automation and the Live Activity's buttons (A7). Never compiled into Release.
  ///
  /// - `-AtdDebug automation <id>` runs the automation as Shortcuts would, linking it.
  /// - `-AtdDebug skip <id>` passes on the step its run waits at (跳过).
  /// - `-AtdDebug resume <id>` continues its interrupted run (继续).
  /// - `-AtdDebug activity-tap <url>` opens the URL as a tap on a run's or the focus timer's
  ///   activity does, through `RouteCenter` and the real route parser: with
  ///   `atd-dev://automation/<id>` while its run waits at a message, that is 发送. (`simctl
  ///   openurl` would leave SpringBoard's confirmation alert on screen, A44.)
  /// - `-AtdDebug automations-sheet …` selects the 自动化 tab, whose page opens the sheet named
  ///   (AtdAppUI's `AutomationsPage`).
  enum DebugLaunch {
    @MainActor static func start(_ engine: AutomationEngine, arguments: [String]) {
      guard let flag = arguments.firstIndex(of: "-AtdDebug"), flag + 2 < arguments.count else {
        return
      }
      let action = arguments[flag + 1]
      let id = arguments[flag + 2]
      switch action {
      case "activity-tap":
        // Before the first view, as a URL Atd is launched with arrives.
        if let url = URL(string: id) { RouteCenter.shared.open(url) }
        return
      case "automations-sheet":
        RouteCenter.shared.open(.automations)
        return
      default:
        break
      }
      Task {
        // An activity starts only with Atd in front, which it is a moment after launch.
        try? await Task.sleep(for: .seconds(1.5))
        switch action {
        case "automation":
          _ = await engine.trigger(id, source: .debug, budget: nil)
        case "skip":
          if let run = await engine.latestRun(of: id), case .awaiting(let step) = run.phase {
            await engine.skip(run: run.id, step: step, budget: nil)
          }
        case "resume":
          if let run = await engine.latestRun(of: id) {
            await engine.resume(run: run.id, budget: nil)
          }
        default:
          break
        }
      }
    }
  }
#endif
