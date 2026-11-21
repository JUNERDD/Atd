import AppIntents
import AtdAutomations
import AtdInk
import AtdModel
import SwiftUI

typealias RunState = AutomationActivityAttributes.ContentState

/// A run's Live Activity on the Lock Screen: the automation and its progress on top, then the
/// steps, the question waiting for the person, or the way to continue a run that stopped. The
/// system draws the platter; the content keeps to its type and colors, like the prototype's.
///
/// The Lock Screen truncates an activity taller than 160 points, so at most four steps show,
/// around the current one.
struct AutomationLockScreenView: View {
  let attributes: AutomationActivityAttributes
  let state: RunState
  /// The run stopped updating (Atd was closed mid-step): it reads as stopped.
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        ActivityTile(symbol: attributes.symbol, tint: attributes.tint)
        Text(attributes.name)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        Spacer(minLength: 4)
        RunProgress(state: state, isStale: isStale)
      }
      if let ask = state.ask, !isStale {
        AskView(attributes: attributes, state: state, ask: ask, link: nil)
      } else if state.phase == .interrupted || isStale {
        ContinueLine(state: state)
      } else {
        StepRows(state: state)
      }
    }
    .padding(14)
  }
}

/// Where a run that stopped picks up once a tap opens Atd: 点一下，从「今日简报」接着做.
struct ContinueLine: View {
  let state: RunState

  var body: some View {
    Text(text)
      .font(.subheadline.weight(.medium))
      .foregroundStyle(.secondary)
      .lineLimit(2)
  }

  private var text: String {
    guard state.steps.indices.contains(state.current) else {
      return ActivityText.string("activity.continue")
    }
    return ActivityText.string("activity.continue.from \(state.steps[state.current].text)")
  }
}

/// The square with the automation's symbol in its hue, as the prototype draws a tile: the
/// symbol's glyph (`InkSymbol`) at 58 percent of the square.
struct ActivityTile: View {
  let symbol: String
  let tint: CommandTint
  var size: CGFloat = 26

  var body: some View {
    InkSymbol(symbol, size: (size * 0.58).rounded())
      .foregroundStyle(glyphColor)
      .frame(width: size, height: size)
      .background(Color(uiColor: tint.uiColor), in: .rect(cornerRadius: size * 0.27))
      .accessibilityHidden(true)
  }

  /// Black on the light hues and white on the others, as the prototype's tiles.
  private var glyphColor: Color {
    switch tint {
    case .orange, .yellow, .green, .mint, .teal, .cyan: .black
    default: .white
    }
  }
}

/// Where the run is, top right: 2/3, 待确认, 完成, or that it stopped.
struct RunProgress: View {
  let state: RunState
  let isStale: Bool

  var body: some View {
    Group {
      switch (state.phase, isStale) {
      case (.finished, _) where state.failures > 0:
        Label(
          ActivityText.string("activity.failures \(state.failures)"),
          systemImage: "exclamationmark.circle.fill"
        )
        .foregroundStyle(.orange)
      case (.finished, _):
        Label(ActivityText.string("activity.done"), systemImage: "checkmark.circle.fill")
          .foregroundStyle(.green)
      case (.interrupted, _), (_, true):
        Text(ActivityText.string("activity.notFinished"))
      case (.awaiting, _):
        Text(ActivityText.string("activity.waiting"))
      case (.running, _):
        Text(verbatim: "\(state.current + 1)/\(state.steps.count)")
          .monospacedDigit()
      }
    }
    .font(.subheadline.weight(.semibold))
    .labelStyle(.titleAndIcon)
    .lineLimit(1)
  }
}

/// Up to four steps, each with its mark, the window following the current step.
struct StepRows: View {
  let state: RunState
  static let visible = 4

  var body: some View {
    let count = state.steps.count
    let first = max(0, min(state.current - 1, count - Self.visible))
    VStack(alignment: .leading, spacing: 3) {
      ForEach(Array(state.steps.enumerated()).dropFirst(first).prefix(Self.visible), id: \.offset) {
        index, step in
        HStack(spacing: 8) {
          StepMark(status: step.status)
          Text(step.text)
            .font(
              .subheadline.weight(
                index == state.current && state.phase == .running ? .semibold : .medium)
            )
            .foregroundStyle(
              step.status == .waiting || step.status == .skipped ? .secondary : .primary
            )
            .lineLimit(1)
        }
        .frame(minHeight: 21)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(step.text), \(StepMark.label(step.status))")
      }
    }
  }
}

/// A step's mark: an empty circle while it waits, a dotted one while it runs, a check, a dash
/// for a step passed on, an exclamation mark for one that did not work.
struct StepMark: View {
  let status: StepRecord.Status

  var body: some View {
    Image(systemName: Self.symbol(status))
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(Self.color(status))
      .frame(width: 18, height: 18)
      .accessibilityHidden(true)
  }

  nonisolated static func symbol(_ status: StepRecord.Status) -> String {
    switch status {
    case .waiting: "circle"
    case .running: "circle.dotted"
    case .done: "checkmark.circle.fill"
    case .skipped: "minus.circle"
    case .failed: "exclamationmark.circle.fill"
    }
  }

  static func color(_ status: StepRecord.Status) -> Color {
    switch status {
    case .waiting, .skipped: .secondary
    case .running: .primary
    case .done: .green
    case .failed: .orange
    }
  }

  static func label(_ status: StepRecord.Status) -> String {
    switch status {
    case .waiting: ActivityText.string("status.waiting")
    case .running: ActivityText.string("status.running")
    case .done: ActivityText.string("status.done")
    case .skipped: ActivityText.string("status.skipped")
    case .failed: ActivityText.string("status.failed")
    }
  }
}

/// The question, with 跳过 and 发送. 跳过 runs `SkipStepIntent` in the app's process without
/// unlocking. 发送 needs Atd in front for the compose sheet, and an activity's intent cannot open
/// the app: on the Lock Screen it is drawn and the tap falls through to the activity's link
/// (`widgetURL`), which asks to unlock; in the expanded Dynamic Island it is a real `link`.
struct AskView: View {
  let attributes: AutomationActivityAttributes
  let state: RunState
  let ask: String
  let link: URL?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(ask)
        .font(.headline)
        .lineLimit(1)
      HStack(spacing: 8) {
        Button(intent: SkipStepIntent(runID: attributes.runID, step: state.current)) {
          ActivityButtonLabel(title: ActivityText.string("activity.skip"), primary: false)
        }
        .buttonStyle(.plain)
        if let link {
          Link(destination: link) {
            ActivityButtonLabel(title: ActivityText.string("activity.send"), primary: true)
          }
        } else {
          ActivityButtonLabel(title: ActivityText.string("activity.send"), primary: true)
            .accessibilityAddTraits(.isButton)
        }
      }
    }
  }
}

/// A capsule button inside an activity, 44 points tall.
struct ActivityButtonLabel: View {
  let title: String
  let primary: Bool

  var body: some View {
    Text(title)
      .font(.body.weight(.semibold))
      .foregroundStyle(primary ? Color.white : Color.primary)
      .frame(maxWidth: .infinity, minHeight: 44)
      .background(
        primary ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary), in: .capsule)
  }
}

/// The widget extension's copy for the automations' activities (`Resources/Automations.xcstrings`).
enum ActivityText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Automations", bundle: .module)
  }
}
