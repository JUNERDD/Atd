import AtdModel
import Foundation

/// A context automation (自动化): a moment in the day that a Shortcuts personal automation notices
/// (到家时, a tap on an NFC tag) and the steps Atd then takes, one after another, with a Live
/// Activity.
///
/// Atd cannot create personal automations. The person creates one in Shortcuts, once, that runs
/// Atd's 运行自动化 action with this automation; Atd learns that it exists the first time it runs
/// (`linkedAt`). The switch (`isEnabled`) only decides whether Atd acts when it is triggered;
/// removing it for good happens in Shortcuts.
public struct Automation: Codable, Sendable, Identifiable, Equatable, Hashable {
  /// Built-in automations keep fixed ids (`home`); the person's own use a UUID.
  public var id: String
  public var trigger: AutomationTrigger
  public var name: String
  /// An SF Symbol name.
  public var symbol: String
  public var tint: CommandTint
  public var steps: [AutomationStep]
  /// Whether Atd acts when Shortcuts runs it.
  public var isEnabled: Bool
  /// When Shortcuts first ran it, which is the only way Atd knows the person set it up.
  public var linkedAt: Date?
  /// Whether its setup ends with Shortcuts' own 朗读文本, which reads the result aloud: Atd's
  /// action returns the result as text, and Shortcuts speaks it.
  public var readsAloud: Bool

  public init(
    id: String, trigger: AutomationTrigger, name: String, symbol: String, tint: CommandTint,
    steps: [AutomationStep], isEnabled: Bool = true, linkedAt: Date? = nil, readsAloud: Bool = false
  ) {
    self.id = id
    self.trigger = trigger
    self.name = name
    self.symbol = symbol
    self.tint = tint
    self.steps = steps
    self.isEnabled = isEnabled
    self.linkedAt = linkedAt
    self.readsAloud = readsAloud
  }

  /// Whether the person has set it up in Shortcuts.
  public var isLinked: Bool { linkedAt != nil }

  /// The focus timer's label when the automation starts and ends a focus session (开始专注记录),
  /// which is then its only step.
  public var focusLabel: String? {
    guard steps.count == 1, case .focus(let label) = steps[0] else { return nil }
    return label
  }
}

/// The moment an automation runs at, as the person set it up in Shortcuts.
public struct AutomationTrigger: Codable, Sendable, Equatable, Hashable {
  public var family: TriggerFamily
  /// What the automation's row says: 到家时, 碰一下「书桌」NFC 标签.
  public var title: String

  public init(family: TriggerFamily, title: String) {
    self.family = family
    self.title = title
  }
}

/// The kinds of personal automation Shortcuts offers that Atd suggests.
public enum TriggerFamily: String, Codable, Sendable, CaseIterable {
  case arrive, leave, nfc, carplay, focus, alarm, charger, time

  /// What 新建自动化 lists: 到达, NFC 标签.
  public var label: String {
    switch self {
    case .arrive: Self.text("family.arrive")
    case .leave: Self.text("family.leave")
    case .nfc: Self.text("family.nfc")
    case .carplay: Self.text("family.carplay")
    case .focus: Self.text("family.focus")
    case .alarm: Self.text("family.alarm")
    case .charger: Self.text("family.charger")
    case .time: Self.text("family.time")
    }
  }

  /// A new automation's trigger: 到达某个地点时. The place, tag or time is picked in Shortcuts,
  /// so Atd never learns it.
  public var genericTitle: String {
    switch self {
    case .arrive: Self.text("family.arrive.title")
    case .leave: Self.text("family.leave.title")
    case .nfc: Self.text("family.nfc.title")
    case .carplay: Self.text("family.carplay.title")
    case .focus: Self.text("family.focus.title")
    case .alarm: Self.text("family.alarm.title")
    case .charger: Self.text("family.charger.title")
    case .time: Self.text("family.time.title")
    }
  }

  /// The trigger's name in Shortcuts' list of personal automations, for the setup steps.
  public var shortcutsName: String {
    switch self {
    case .arrive: Self.text("family.arrive.shortcuts")
    case .leave: Self.text("family.leave.shortcuts")
    case .nfc: Self.text("family.nfc.shortcuts")
    case .carplay: Self.text("family.carplay.shortcuts")
    case .focus: Self.text("family.focus.shortcuts")
    case .alarm: Self.text("family.alarm.shortcuts")
    case .charger: Self.text("family.charger.shortcuts")
    case .time: Self.text("family.time.shortcuts")
    }
  }

  /// An SF Symbol name.
  public var symbol: String {
    switch self {
    case .arrive: "mappin.and.ellipse"
    case .leave: "figure.walk"
    case .nfc: "sensor.tag.radiowaves.forward"
    case .carplay: "car"
    case .focus: "moon"
    case .alarm: "alarm"
    case .charger: "battery.100percent.bolt"
    case .time: "clock"
    }
  }

  public var tint: CommandTint {
    switch self {
    case .arrive: .orange
    case .leave: .blue
    case .nfc: .gray
    case .carplay: .green
    case .focus: .indigo
    case .alarm: .red
    case .charger: .mint
    case .time: .cyan
    }
  }

  private static func text(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }
}

/// One thing an automation does.
///
/// Reading the agenda and the ledger stays on the iPhone. The briefing and commands send that
/// day's agenda or the previous step's result to the person's model, exactly as running the
/// command does. A message is never sent by Atd: the run stops for the person, and they send it
/// themselves in the system's compose sheet.
public enum AutomationStep: Codable, Sendable, Equatable, Hashable {
  /// 看明天的日程: the day's events and reminders, read from Calendar and Reminders.
  case agenda(day: AgendaDay)
  /// 总结今天的账: what was paid today, read from the ledger.
  case ledgerToday
  /// 今日简报 on the day's agenda, with the briefing command's own options.
  case briefing(day: AgendaDay)
  /// A command from the library, on the previous step's result when it reads text, or on its
  /// instructions alone when it reads nothing.
  case command(id: String)
  /// 发一条信息: waits for the person to approve, then opens the system's compose sheet.
  case message(draft: MessageDraft)
  /// Starts the focus timer, or ends the session it started.
  case focus(label: String)

  /// Whether the run stops here until the person says so: everything done in their name.
  public var needsApproval: Bool {
    if case .message = self { true } else { false }
  }

  /// Whether the step leaves a text a later step can work on.
  public var givesText: Bool {
    switch self {
    case .agenda, .ledgerToday, .briefing, .command: true
    case .message, .focus: false
    }
  }
}

/// The day an agenda step reads, counted from when it runs.
public enum AgendaDay: String, Codable, Sendable, CaseIterable {
  case today, tomorrow

  /// The day's date when it runs at `now`.
  public func date(from now: Date, calendar: Calendar = .current) -> Date {
    switch self {
    case .today: now
    case .tomorrow: calendar.date(byAdding: .day, value: 1, to: now) ?? now
    }
  }
}

/// A message the person sends themselves.
public struct MessageDraft: Codable, Sendable, Equatable, Hashable {
  /// Who it goes to; with nobody, the compose sheet starts without a recipient.
  public var recipients: [MessageRecipient]
  public var body: String

  public init(recipients: [MessageRecipient] = [], body: String) {
    self.recipients = recipients
    self.body = body
  }
}

public struct MessageRecipient: Codable, Sendable, Equatable, Hashable {
  /// What the steps call them: the contact's name, or the address when it has none.
  public var name: String
  /// A phone number or an email address.
  public var address: String

  public init(name: String, address: String) {
    self.name = name
    self.address = address
  }
}
