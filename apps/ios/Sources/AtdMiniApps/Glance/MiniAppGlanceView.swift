import AppIntents
import AtdInk
import SwiftUI

/// The sizes a mini app's widget comes in: the Home Screen's small and medium, and the Lock
/// Screen's circle, rectangle and line. Mirrors WidgetKit's families without depending on them,
/// so the app draws the same views in its previews.
public enum MiniAppGlanceFamily: Sendable, Hashable, CaseIterable {
  case small, medium, circular, rectangular, inline
}

/// A mini app's widget content, drawn from its glance in ink: the system draws the frame, and a
/// widget adds its own container background. Buttons and ticks run their App Intents in place
/// (`MiniAppStepIntent`, `MiniAppCheckIntent`); a preview in the app turns hit testing off.
public struct MiniAppGlanceView: View {
  let glance: MiniAppGlance
  let family: MiniAppGlanceFamily

  public init(glance: MiniAppGlance, family: MiniAppGlanceFamily) {
    self.glance = glance
    self.family = family
  }

  public var body: some View {
    switch family {
    case .small, .medium: home
    case .circular: CircularGlance(glance: glance)
    case .rectangular: RectangularGlance(glance: glance)
    case .inline: InlineGlance(glance: glance)
    }
  }

  @ViewBuilder private var home: some View {
    let medium = family == .medium
    let tint = glance.head.tint
    Group {
      switch glance.body {
      case .counter(let counter):
        CounterGlance(head: glance.head, counter: counter, medium: medium, label: glance.label)
      case .streak(let streak):
        StreakGlance(head: glance.head, streak: streak, medium: medium)
          .glanceLabel(glance.label)
      case .checklist(let checklist):
        ChecklistGlance(
          head: glance.head, checklist: checklist, medium: medium, label: glance.label)
      case .ledger(let ledger):
        LedgerGlance(head: glance.head, ledger: ledger, medium: medium).glanceLabel(glance.label)
      case .stat(let stat):
        StatGlance(head: glance.head, stat: stat, medium: medium).glanceLabel(glance.label)
      case .rows(let rows):
        RowsGlance(head: glance.head, rows: rows, medium: medium).glanceLabel(glance.label)
      case .missing(let message):
        VStack(alignment: .leading, spacing: 6) {
          GlanceHead(head: glance.head)
          Spacer(minLength: 0)
          Text(message).sub()
        }
        .glanceLabel(glance.label)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .tint(Color(uiColor: tint.uiColor))
  }
}

extension View {
  /// Reads the glance as one element: what VoiceOver says for the widget.
  func glanceLabel(_ label: String) -> some View {
    accessibilityElement(children: .ignore).accessibilityLabel(label)
  }
}

/// 记账本: this month's spending, today's and the last seven days.
struct LedgerGlance: View {
  let head: MiniAppGlance.Head
  let ledger: MiniAppGlance.LedgerBody
  let medium: Bool

  var body: some View {
    if medium {
      HStack(spacing: 16) {
        summary.frame(width: 132, alignment: .leading)
        VStack(alignment: .leading, spacing: 6) {
          Text(ledger.chartKicker).kicker()
          Spacer(minLength: 0)
          InkBars(values: ledger.week, height: 74, labels: ledger.weekLabels, tint: head.tint)
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 0) {
        summary
        InkBars(values: ledger.week, height: 20, tint: head.tint).padding(.top, 8)
      }
    }
  }

  private var summary: some View {
    VStack(alignment: .leading, spacing: 0) {
      GlanceHead(head: head)
      Spacer(minLength: 4)
      Text(ledger.kicker).kicker()
      BigValue(value: ledger.month)
      Text(ledger.today).sub()
    }
  }
}

/// 喝水 and other counters: today's value in a ring against the goal, and the button that adds
/// one step without opening Atd.
struct CounterGlance: View {
  let head: MiniAppGlance.Head
  let counter: MiniAppGlance.Counter
  let medium: Bool
  let label: String

  var body: some View {
    if medium {
      HStack(spacing: 16) {
        column
        VStack(alignment: .leading, spacing: 6) {
          Spacer(minLength: 0)
          InkBars(
            values: counter.week, height: 64, labels: counter.weekLabels, fillsAll: true,
            tint: head.tint)
        }
      }
    } else {
      column
    }
  }

  private var column: some View {
    VStack(alignment: .leading, spacing: 0) {
      Group {
        GlanceHead(head: head)
        HStack(spacing: 10) {
          InkRing(fraction: counter.fraction, size: 62, stroke: 9, tint: head.tint) {
            Text(counter.today)
              .font(.system(size: 24, weight: .bold))
              .monospacedDigit()
              .minimumScaleFactor(0.6)
          }
          VStack(alignment: .leading, spacing: 1) {
            Text(counter.kicker).kicker()
            Text(counter.headline)
              .font(.system(size: 20, weight: .bold))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
            if let caption = counter.caption { Text(caption).caption() }
          }
        }
        .frame(maxHeight: .infinity)
      }
      .glanceLabel(label)
      Button(intent: MiniAppStepIntent(counter.step)) {
        Label(counter.button, systemImage: "plus")
          .labelStyle(TightLabelStyle())
      }
      .buttonStyle(GlanceButtonStyle(tint: head.tint))
      .accessibilityLabel(counter.buttonLabel)
    }
  }
}

/// Days in a row: the streak, today's value and the last week as dots (bars too when medium).
struct StreakGlance: View {
  let head: MiniAppGlance.Head
  let streak: MiniAppGlance.Streak
  let medium: Bool

  var body: some View {
    if medium {
      HStack(spacing: 16) {
        column
        VStack(alignment: .leading, spacing: 6) {
          Spacer(minLength: 0)
          InkBars(
            values: streak.week, height: 64, labels: streak.weekLabels, fillsAll: true,
            tint: head.tint)
        }
      }
    } else {
      column
    }
  }

  private var column: some View {
    VStack(alignment: .leading, spacing: 0) {
      GlanceHead(head: head)
      Text(streak.kicker).kicker().padding(.top, 10)
      BigValue(value: streak.days, unit: streak.unit)
      Text(streak.sub).sub()
      Spacer(minLength: 4)
      if !medium {
        InkDots(done: streak.weekDone, labels: streak.weekLabels, tint: head.tint)
      }
    }
  }
}

/// Icon and title close together, as the widget's buttons draw them.
struct TightLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.system(size: 14, weight: .bold))
      configuration.title
    }
  }
}
