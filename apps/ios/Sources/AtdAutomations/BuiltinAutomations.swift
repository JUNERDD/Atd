import Foundation

/// The automations a new book starts with: the prototype's five, each reduced to what iOS lets an
/// app do. None is linked yet: each waits until the person sets it up in Shortcuts.
///
/// Their triggers, names and the message's text come from this module's String Catalog in the
/// language the book is first created in; after that they are the person's data.
public enum BuiltinAutomations {
  public static let homeID = "home"
  public static let leaveID = "leave"
  public static let carplayID = "carplay"
  public static let deskID = "desk"
  public static let sleepID = "sleep"

  /// The built-in automations' ids, which the person can switch off but not delete.
  public static let ids: Set<String> = [homeID, leaveID, carplayID, deskID, sleepID]

  public static func all() -> [Automation] {
    [home(), leave(), carplay(), desk(), sleep()]
  }

  /// 到家清单: tomorrow's agenda, a message the person sends, and today's spending. Summing up
  /// unread messages is left out: no app can read another app's messages or notifications.
  static func home() -> Automation {
    Automation(
      id: homeID, trigger: AutomationTrigger(family: .arrive, title: text("builtin.home.trigger")),
      name: text("builtin.home.name"), symbol: "house", tint: .orange,
      steps: [
        .agenda(day: .tomorrow), .message(draft: MessageDraft(body: text("builtin.home.message"))),
        .ledgerToday,
      ])
  }

  /// 通勤简报: the briefing on tomorrow's agenda. Weather (no weather service) and unanswered
  /// messages (unreadable) are left out.
  static func leave() -> Automation {
    Automation(
      id: leaveID, trigger: AutomationTrigger(family: .leave, title: text("builtin.leave.trigger")),
      name: text("builtin.leave.name"), symbol: "building.2", tint: .blue,
      steps: [.briefing(day: .tomorrow)])
  }

  /// 用语音读今日简报: Atd writes today's briefing and returns it, and Shortcuts' 朗读文本, which
  /// the setup adds after Atd's action, reads it aloud. Atd plays no audio itself.
  static func carplay() -> Automation {
    Automation(
      id: carplayID,
      trigger: AutomationTrigger(family: .carplay, title: text("builtin.carplay.trigger")),
      name: text("builtin.carplay.name"), symbol: "car", tint: .green,
      steps: [.briefing(day: .today)],
      readsAloud: true)
  }

  /// 开始专注记录: the first tap starts the focus timer and the next one ends it.
  static func desk() -> Automation {
    Automation(
      id: deskID, trigger: AutomationTrigger(family: .nfc, title: text("builtin.desk.trigger")),
      name: text("builtin.desk.name"), symbol: "sensor.tag.radiowaves.forward", tint: .gray,
      steps: [.focus(label: text("builtin.desk.label"))])
  }

  /// 总结今天的账: reads today's spending. Nothing is filed or changed at night, and the summary
  /// stays in the run instead of a morning notification.
  static func sleep() -> Automation {
    Automation(
      id: sleepID, trigger: AutomationTrigger(family: .focus, title: text("builtin.sleep.trigger")),
      name: text("builtin.sleep.name"), symbol: "moon", tint: .indigo, steps: [.ledgerToday])
  }

  /// Literal keys only: a key put together at runtime would become a format key
  /// (`builtin.%@`) that the catalog does not have.
  private static func text(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }
}
