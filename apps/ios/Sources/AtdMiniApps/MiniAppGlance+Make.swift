import AtdModel
import Foundation

extension MiniAppGlance {
  /// The glance of `app` at `now`: its widget template filled from its data, or from the shared
  /// ledger for 记账本. A missing manifest or data reads as `.missing`.
  public static func make(
    app: MiniApp, manifest: MiniAppManifest?, data: MiniAppData?, ledger: Ledger? = nil,
    now: Date = .now, calendar: Calendar = .current, locale: Locale = .current
  ) -> MiniAppGlance {
    guard let manifest, let data else { return .missing(app) }
    let maker = Maker(app: app, data: data, now: now, calendar: calendar, locale: locale)
    switch manifest.widget {
    case .counter(let spec): return maker.counter(spec)
    case .streak(let spec): return maker.streak(spec)
    case .checklist(let spec): return maker.checklist(spec)
    case .ledger: return maker.ledger(ledger ?? Ledger())
    case .stat(let spec): return maker.stat(spec)
    case .list(let spec): return maker.rows(spec)
    }
  }
}

private struct Maker {
  let app: MiniApp
  let data: MiniAppData
  let now: Date
  let calendar: Calendar
  let locale: Locale

  private var head: MiniAppGlance.Head {
    MiniAppGlance.Head(id: app.id, name: app.name, symbol: app.symbol, tint: app.tint)
  }

  private func text(_ key: String.LocalizationValue) -> String {
    MiniAppGlance.localized(key)
  }

  /// 天, or day and days.
  private func dayUnit(_ count: Int) -> String {
    count == 1 ? text("glance.streak.day") : text("glance.streak.days")
  }

  private func number(_ value: Double) -> String {
    MiniAppFormat.number(value, locale: locale)
  }

  private func amount(_ value: Double, _ unit: String) -> String {
    MiniAppFormat.amount(value, unit: unit, locale: locale)
  }

  private func stats(_ series: String, goal: Double?) -> MiniAppSeriesStats {
    MiniAppSeriesStats(
      series: data.series(series), goal: goal, now: now,
      calendar: MiniAppDay.calendar(timeZone: calendar.timeZone), locale: locale)
  }

  private func glance(
    _ body: MiniAppGlance.Body, meta: String, label: [String?], accessory: MiniAppGlance.Accessory
  ) -> MiniAppGlance {
    let parts = ([app.name] + label).compactMap { $0 }.filter { !$0.isEmpty }
    return MiniAppGlance(
      head: head, body: body, meta: meta, label: parts.joined(separator: MiniAppGlance.separator),
      accessory: accessory)
  }

  func counter(_ spec: MiniAppWidgetSpec.Counter) -> MiniAppGlance {
    let goal = spec.goal?.value(in: data).flatMap { $0 > 0 ? $0 : nil }
    let stats = stats(spec.series, goal: goal)
    let reached = goal.map { stats.today >= $0 } ?? false
    let today = number(stats.today)
    let headline: String
    if reached {
      headline = text("glance.counter.reached")
    } else if let goal {
      headline = amount(max(0, goal - stats.today), spec.unit)
    } else {
      headline = amount(stats.today, spec.unit)
    }
    let kicker =
      goal != nil && !reached ? text("glance.counter.left") : text("glance.counter.today")
    let progress = goal.map { "\(today)/\(number($0))" } ?? today
    let meta = text("glance.today \(spec.unit.isEmpty ? progress : "\(progress) \(spec.unit)")")
    let button = spec.button ?? amount(spec.step, spec.unit)
    let body = MiniAppGlance.Counter(
      today: today, fraction: goal.map { min(1, max(0, stats.today / $0)) } ?? 0, kicker: kicker,
      headline: headline, caption: goal.map { text("glance.goal \(amount($0, spec.unit))") },
      button: button, buttonLabel: text("glance.counter.add \(button)"),
      step: MiniAppStep(appID: app.id, field: spec.series, amount: spec.step), week: stats.week,
      weekLabels: stats.weekLabels)
    return glance(
      .counter(body), meta: meta,
      label: [
        text("glance.today \(amount(stats.today, spec.unit))"),
        goal.map { text("glance.goal \(amount($0, spec.unit))") },
      ],
      accessory: MiniAppGlance.Accessory(
        value: progress, fraction: goal == nil ? nil : body.fraction, line: meta,
        detail: reached || goal == nil ? headline : "\(kicker) \(headline)",
        inline: "\(app.name) \(spec.unit.isEmpty ? progress : "\(progress) \(spec.unit)")"))
  }

  func streak(_ spec: MiniAppWidgetSpec.Streak) -> MiniAppGlance {
    let stats = stats(spec.series, goal: spec.goal?.value(in: data))
    let kicker = spec.kicker.isEmpty ? text("glance.streak.kicker") : spec.kicker
    let sub =
      stats.today > 0
      ? text("glance.today \(amount(stats.today, spec.unit))") : text("glance.streak.none")
    let meta = text("glance.streak.meta \(kicker) \(stats.streak)")
    let body = MiniAppGlance.Streak(
      kicker: kicker, days: "\(stats.streak)", unit: dayUnit(stats.streak),
      sub: sub,
      week: stats.week, weekDone: stats.weekDone, weekLabels: stats.weekLabels)
    return glance(
      .streak(body), meta: meta, label: [meta, sub],
      accessory: MiniAppGlance.Accessory(
        value: "\(stats.streak)", fraction: nil, line: meta, detail: sub,
        inline: "\(app.name) \(text("glance.streak.inline \(stats.streak)"))"))
  }

  func checklist(_ spec: MiniAppWidgetSpec.Checklist) -> MiniAppGlance {
    let records = data.records(spec.list)
    let pending = records.filter { $0[spec.done]?.bool != true }
    let done = records.count - pending.count
    let kicker = spec.kicker ?? text("glance.checklist.kicker")
    let finished = spec.finished ?? text("glance.checklist.finished")
    let next = pending.first?[spec.label]?.string
    let sub =
      next.map {
        text("glance.checklist.next \(spec.next ?? text("glance.checklist.nextDefault")) \($0)")
      } ?? finished
    let meta = "\(kicker) \(done)/\(records.count)"
    let rows = pending.prefix(3).map { record in
      MiniAppGlance.Checklist.Row(
        id: record.recordID ?? "", label: record[spec.label]?.string ?? "", done: false)
    }
    let body = MiniAppGlance.Checklist(
      done: done, total: records.count, kicker: kicker, sub: sub, finished: finished, rows: rows,
      toggle: MiniAppToggle(appID: app.id, list: spec.list, field: spec.done))
    let fraction = records.isEmpty ? 0 : Double(done) / Double(records.count)
    return glance(
      .checklist(body), meta: meta, label: [meta, sub],
      accessory: MiniAppGlance.Accessory(
        value: "\(done)/\(records.count)", fraction: fraction, line: meta, detail: sub,
        inline: "\(app.name) \(done)/\(records.count)"))
  }

  func ledger(_ ledger: Ledger) -> MiniAppGlance {
    let summary = MiniAppLedgerSummary(ledger: ledger, now: now, calendar: calendar, locale: locale)
    let month = MiniAppFormat.money(summary.month, currency: summary.currency, locale: locale)
    let todayTotal = MiniAppFormat.money(summary.today, currency: summary.currency, locale: locale)
    let today = text("glance.ledger.today \(todayTotal) \(summary.todayCount)")
    let body = MiniAppGlance.LedgerBody(
      kicker: text("glance.ledger.kicker"), month: month, today: today,
      chartKicker: text("glance.ledger.week"),
      week: summary.week.map { NSDecimalNumber(decimal: $0).doubleValue },
      weekLabels: summary.weekLabels)
    let meta = text("glance.ledger.meta \(month)")
    return glance(
      .ledger(body), meta: meta,
      label: [
        text("glance.ledger.label.month \(month)"),
        text("glance.ledger.label.today \(todayTotal) \(summary.todayCount)"),
      ],
      accessory: MiniAppGlance.Accessory(
        value: MiniAppFormat.shortMoney(summary.month, currency: summary.currency, locale: locale),
        fraction: nil, line: meta, detail: today, inline: "\(app.name) \(month)"))
  }

  func stat(_ spec: MiniAppWidgetSpec.Stat) -> MiniAppGlance {
    var value = "–"
    var unit = spec.unit
    var sub: String?
    switch spec.value {
    case .field(let name):
      value = number(data.number(name) ?? 0)
    case .series(let name, let part):
      let stats = stats(name, goal: nil)
      switch part {
      case .today: value = number(stats.today)
      case .week: value = number(stats.week.reduce(0, +))
      case .month: value = number(stats.month)
      case .total: value = number(stats.total)
      case .streak:
        value = "\(stats.streak)"
        unit = unit ?? dayUnit(stats.streak)
      }
    case .daysUntil(let name):
      if let day = data.day(name),
        let days = MiniAppDay.days(
          until: day, now: now, calendar: MiniAppDay.calendar(timeZone: calendar.timeZone))
      {
        value = "\(abs(days))"
        unit = unit ?? dayUnit(abs(days))
        if days < 0 { sub = text("glance.stat.passed") }
      } else {
        sub = text("glance.stat.noDate")
      }
    }
    let bars = spec.bars.map { stats($0, goal: nil) }
    let shown = [value, unit].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    let meta = spec.kicker.isEmpty ? shown : "\(spec.kicker) \(shown)"
    let body = MiniAppGlance.Stat(
      kicker: spec.kicker, value: value, unit: unit, sub: sub, bars: bars?.week,
      barLabels: bars?.weekLabels ?? [])
    return glance(
      .stat(body), meta: meta, label: [meta, sub],
      accessory: MiniAppGlance.Accessory(
        value: value, fraction: nil, line: meta, detail: sub, inline: "\(app.name) \(shown)"))
  }

  func rows(_ spec: MiniAppWidgetSpec.Rows) -> MiniAppGlance {
    let records = Array(data.records(spec.list).reversed())
    let rows = records.prefix(5).map { record in
      MiniAppGlance.Rows.Row(
        id: record.recordID ?? "", title: record[spec.title]?.string ?? "",
        trailing: spec.trailing.flatMap { describe(record[$0]) })
    }
    let empty = text("glance.rows.empty")
    let meta = rows.first?.title ?? empty
    let body = MiniAppGlance.Rows(
      kicker: spec.kicker ?? text("glance.rows.kicker"), rows: Array(rows), empty: empty)
    return glance(
      .rows(body), meta: meta,
      label: [body.kicker, rows.prefix(3).map(\.title).joined(separator: "、")],
      accessory: MiniAppGlance.Accessory(
        value: "\(records.count)", fraction: nil, line: meta, detail: rows.dropFirst().first?.title,
        inline: "\(app.name) \(meta)"))
  }

  private func describe(_ value: MiniAppJSON?) -> String? {
    switch value {
    case .number(let number)?: return self.number(number)
    case .string(let text)?:
      if let date = MiniAppDay.date(
        text, calendar: MiniAppDay.calendar(timeZone: calendar.timeZone))
      {
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale))
      }
      return text.isEmpty ? nil : text
    default: return nil
    }
  }
}
