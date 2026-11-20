import AtdModel
import Foundation

/// What a mini app's widget and its 小应用 card show, computed from the data alone: the template's
/// values as text and numbers, the card's line and what VoiceOver reads. A widget, its preview in
/// the app and the card all draw from this, so they never disagree.
public struct MiniAppGlance: Sendable, Equatable {
  public struct Head: Sendable, Equatable {
    public var id: String
    public var name: String
    public var symbol: String
    public var tint: CommandTint
  }

  public var head: Head
  public var body: Body
  /// The line under the name on the app's card (本月 ¥2,384, 今天 5/8 杯).
  public var meta: String
  /// What VoiceOver reads for the whole widget (喝水，今天 5 杯，目标 8 杯).
  public var label: String
  public var accessory: Accessory

  public enum Body: Sendable, Equatable {
    case counter(Counter)
    case streak(Streak)
    case checklist(Checklist)
    case ledger(LedgerBody)
    case stat(Stat)
    case rows(Rows)
    /// The app's files cannot be read, or it was deleted.
    case missing(String)
  }

  /// Today's value of a daily series against its goal, and the button that adds to it.
  public struct Counter: Sendable, Equatable {
    public var today: String
    /// Today against the goal, 0 to 1; 0 without a goal.
    public var fraction: Double
    /// 还差 or 今天.
    public var kicker: String
    /// 3 杯, or 已达标.
    public var headline: String
    /// 目标 8 杯.
    public var caption: String?
    /// The button's label (1 杯) and what VoiceOver reads for it.
    public var button: String
    public var buttonLabel: String
    public var step: MiniAppStep
    public var week: [Double]
    public var weekLabels: [String]
  }

  public struct Streak: Sendable, Equatable {
    /// 连续读书.
    public var kicker: String
    public var days: String
    /// 天.
    public var unit: String
    /// 今天 30 页, or 今天还没记.
    public var sub: String
    public var week: [Double]
    public var weekDone: [Bool]
    public var weekLabels: [String]
  }

  public struct Checklist: Sendable, Equatable {
    public struct Row: Sendable, Equatable, Identifiable {
      public var id: String
      public var label: String
      public var done: Bool
    }

    public var done: Int
    public var total: Int
    /// 已打包.
    public var kicker: String
    /// 下一件：头灯, or 都装好了.
    public var sub: String
    public var finished: String
    /// The first records not yet ticked, at most three.
    public var rows: [Row]
    public var toggle: MiniAppToggle
  }

  public struct LedgerBody: Sendable, Equatable {
    /// 本月支出.
    public var kicker: String
    public var month: String
    /// 今天 ¥68 · 3 笔.
    public var today: String
    /// 近 7 天.
    public var chartKicker: String
    public var week: [Double]
    public var weekLabels: [String]
  }

  public struct Stat: Sendable, Equatable {
    public var kicker: String
    public var value: String
    public var unit: String?
    public var sub: String?
    public var bars: [Double]?
    public var barLabels: [String]
  }

  public struct Rows: Sendable, Equatable {
    public struct Row: Sendable, Equatable, Identifiable {
      public var id: String
      public var title: String
      public var trailing: String?
    }

    public var kicker: String
    public var rows: [Row]
    /// 还没有记录.
    public var empty: String
  }

  /// The same values cut to the Lock Screen's sizes.
  public struct Accessory: Sendable, Equatable {
    /// 5/8, 12, ¥2.4K: the circle's number.
    public var value: String
    /// How full the circle's gauge is, when the value has a goal.
    public var fraction: Double?
    /// The rectangle's lines: 今天 5/8 杯, then 还差 3 杯.
    public var line: String
    public var detail: String?
    /// One line beside the clock: 喝水 5/8 杯.
    public var inline: String
  }
}

/// What a counter widget's button adds: `MiniAppStepIntent` performs it.
public struct MiniAppStep: Sendable, Equatable {
  public var appID: String
  public var field: String
  public var amount: Double
}

/// Which records a checklist widget's rows tick: `MiniAppCheckIntent` performs it.
public struct MiniAppToggle: Sendable, Equatable {
  public var appID: String
  public var list: String
  public var field: String
}

extension MiniAppGlance {
  /// The glance of an app whose files cannot be read, or that was deleted after its widget was
  /// added.
  public static func missing(_ app: MiniApp?, name: String? = nil) -> MiniAppGlance {
    let text = app == nil ? localized("glance.deleted") : localized("glance.missing")
    let title = app?.name ?? name ?? localized("glance.app")
    return MiniAppGlance(
      head: Head(
        id: app?.id ?? "", name: title, symbol: app?.symbol ?? "square.grid.2x2",
        tint: app?.tint ?? .gray),
      body: .missing(text), meta: text, label: [title, text].joined(separator: separator),
      accessory: Accessory(value: "–", fraction: nil, line: text, detail: nil, inline: title))
  }

  static func localized(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }

  /// How the parts of a VoiceOver label are joined (，or a comma).
  static var separator: String { localized("glance.separator") }
}
