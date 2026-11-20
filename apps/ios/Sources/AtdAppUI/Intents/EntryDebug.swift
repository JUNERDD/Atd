#if DEBUG
  import ActivityKit
  import AtdAI
  import AtdIntents
  import AtdModel
  import Foundation

  /// The entry points' launch hooks for checks on the simulator that simctl cannot tap:
  /// `-AtdDebug briefing <phase>` shows 今日简报's Live Activity in `working`, `done`,
  /// `needsAccess`, `noModel` or `failed` with sample content, `-AtdDebug briefing run` runs the
  /// briefing for real, as its control does, and `-AtdDebug briefing end` ends every activity;
  /// `-AtdDebug run <command id>` opens the run sheet a control opens for that command;
  /// `-AtdDebug url <url>` opens a link the way a widget's tap does. Debug builds only.
  enum EntryDebug {
    static func start(arguments: [String]) {
      guard let flag = arguments.firstIndex(of: "-AtdDebug"), arguments.count > flag + 2 else {
        return
      }
      let value = arguments[flag + 2]
      switch arguments[flag + 1] {
      case "briefing": Task { await briefing(value) }
      case "run": CommandRunCenter.shared.open(CommandRunRequest(commandID: value))
      case "url": if let url = URL(string: value) { RouteCenter.shared.open(url) }
      default: break
      }
    }

    /// Off the main actor, like ActivityKit's methods, since activities are not `Sendable`.
    @concurrent
    private static func briefing(_ mode: String) async {
      guard let context = try? EntryContext.live(),
        let command = try? context.command(BuiltinCommands.briefingID)
      else { return }
      if mode == "run" {
        _ = await CommandActivity.run(command, context: context)
        return
      }
      for activity in Activity<BriefingActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      guard let state = sample(mode) else { return }
      _ = try? Activity.request(
        attributes: BriefingActivityAttributes(command: command, day: .now),
        content: ActivityContent(state: state, staleDate: nil), pushType: nil, style: .standard)
    }

    /// Synthetic content for each phase; the sentences are made up.
    nonisolated private static func sample(_ mode: String)
      -> BriefingActivityAttributes.ContentState?
    {
      switch mode {
      case "working": .init(phase: .working)
      case "done":
        .init(
          phase: .done,
          lines: [
            "10:00 产品周会（3 号会议室），19:00 记得取快递。",
            "下午 3 点和设计组对一下新首页。",
            "还有 2 条提醒没完成。",
          ])
      case "needsAccess": .init(phase: .needsAccess)
      case "noModel": .init(phase: .noModel)
      case "failed": .init(phase: .failed, message: ModelFailure.offline.message, canRetry: true)
      default: nil
      }
    }
  }
#endif
