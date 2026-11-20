import ActivityKit
import AppIntents
import AtdActions
import AtdModel
import UIKit
import WidgetKit

/// 允许访问日历, on the Lock Screen's 下一项 and in 今日简报's Live Activity: opens Atd, which asks
/// for full access to the calendar and reminders where the system still can, then reloads 下一项
/// and runs the briefing that was waiting for it. When there is nothing left to ask and the
/// calendar stays closed, it opens Atd's page in Settings, the only place to change that.
public struct GrantAgendaAccessIntent: AppIntent {
  public static let title = LocalizedStringResource("grantAccess.title", table: "EntryIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .foreground(.immediate)

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    let reader = TodayReader()
    let askable = ProtectedData.allCases.filter {
      [.notDetermined, .writeOnly].contains(reader.access(to: $0))
    }
    if askable.isEmpty, reader.access(to: .calendar) != .full,
      let settings = URL(string: UIApplication.openSettingsURLString)
    {
      return .result(opensIntent: OpenURLIntent(settings))
    }
    for data in askable {
      // A refusal is the person's answer; what they allowed is read below.
      try? await reader.requestAccess(to: data)
    }
    WidgetCenter.shared.reloadTimelines(ofKind: EntryWidgetKind.nextItem)
    let readable = ProtectedData.allCases.contains { reader.access(to: $0) == .full }
    let waiting = Activity<BriefingActivityAttributes>.activities.first {
      $0.content.state.phase == .needsAccess
    }
    if readable, let waiting, let context = try? EntryContext.live(),
      let command = try? context.command(waiting.attributes.commandID)
    {
      _ = await CommandActivity.run(command, context: context)
    }
    return .result()
  }
}

/// The widget kinds an intent reloads, which the widget extension declares with the same names.
public enum EntryWidgetKind {
  public static let nextItem = "lock.next"
}
