import AtdAutomations
import AtdModel
import Foundation

/// The 自动化 tab's copy, from the `Automations` table of this module's resources.
enum AutomationText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Automations", bundle: .module)
  }
}

extension Automation {
  /// Built-in automations can be switched off but not deleted, like the built-in commands.
  var isBuiltin: Bool {
    BuiltinAutomations.ids.contains(id)
  }

  /// A row's one secondary line: what runs, or what the run is doing now.
  func summary(latest run: AutomationRun?) -> String {
    switch run?.phase {
    case .awaiting: AutomationText.string("row.awaiting")
    case .running: AutomationText.string("row.running \(name)")
    case .interrupted: AutomationText.string("row.interrupted \(name)")
    default: AutomationText.string("row.runs \(name)")
    }
  }
}

extension AutomationRun {
  /// Where the run is, for the head of its section: 正在运行 · 2/3, 等你确认, 没做完, 11:02 完成.
  var status: String {
    switch phase {
    case .running(let step): AutomationText.string("run.running \(step + 1) \(plan.count)")
    case .awaiting: AutomationText.string("run.awaiting")
    case .interrupted: AutomationText.string("run.interrupted")
    case .finished where failures > 0:
      AutomationText.string("run.finishedWithFailures \(finishedWhen) \(failures)")
    case .finished:
      AutomationText.string("run.finished \(finishedWhen)")
    }
  }

  /// 5 分钟前.
  private var finishedWhen: String {
    updatedAt.formatted(.relative(presentation: .named))
  }
}
