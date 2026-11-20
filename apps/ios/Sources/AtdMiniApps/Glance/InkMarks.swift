import AtdInk
import AtdModel
import SwiftUI

/// How a glance is drawn. On a full-color Home Screen the marks are highlighter on paper; where
/// the system draws the widget in one color (a tinted or clear Home Screen, the Lock Screen,
/// StandBy) a pastel fill would turn into a solid block, so only the inked lines are drawn.
public enum MiniAppGlanceStyle: Sendable, Hashable {
  case fullColor
  case monochrome
}

extension EnvironmentValues {
  @Entry public var miniAppGlanceStyle: MiniAppGlanceStyle = .fullColor
}

/// The highlighter a mini app's marks are filled with: its tint, stronger than its sticker.
func markFill(_ tint: CommandTint) -> Color {
  InkColor.highlighter(tint.uiColor, light: 0.42, dark: 0.5)
}

/// The app's sticker and name, the same mark as on its 小应用 card.
struct GlanceHead: View {
  let head: MiniAppGlance.Head
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    HStack(spacing: 6) {
      if style == .fullColor {
        Sticker(symbol: head.symbol, tint: head.tint, seed: head.id, size: 20)
      } else {
        Image(systemName: head.symbol)
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 20, height: 20)
          .accessibilityHidden(true)
      }
      Text(head.name)
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
    }
  }
}

/// A highlighter arc between two inked circles, clockwise from the top; what it does not fill
/// stays paper.
struct InkRing<Label: View>: View {
  let fraction: Double
  let size: CGFloat
  let stroke: CGFloat
  let tint: CommandTint
  @ViewBuilder let label: Label
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    ZStack {
      Circle()
        .trim(from: 0, to: min(1, max(0, fraction)))
        .stroke(
          style == .fullColor ? markFill(tint) : Color.primary,
          style: StrokeStyle(
            lineWidth: style == .fullColor ? stroke : stroke * 0.42, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
        .padding(stroke / 2)
      Circle().stroke(InkColor.line, lineWidth: 1.3)
      Circle().stroke(InkColor.line, lineWidth: 1.3).padding(stroke)
      label
    }
    .frame(width: size, height: size)
  }
}

/// The last days as inked bars; today's (or every day's) filled with the highlighter.
struct InkBars: View {
  let values: [Double]
  let height: CGFloat
  var labels: [String]?
  var fillsAll = false
  let tint: CommandTint
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    let top = max(1, values.max() ?? 1)
    HStack(alignment: .bottom, spacing: 4) {
      ForEach(values.indices, id: \.self) { index in
        VStack(spacing: 3) {
          let filled = fillsAll || index == values.count - 1
          let shape = InkShape(corners: Self.corners, wobble: 0.35, seed: index * 13)
          shape
            .fill(filled && style == .fullColor ? markFill(tint) : Color.clear)
            .overlay(shape.stroke(filled ? Color.primary : InkColor.line, lineWidth: 1))
            .frame(height: max(3, (values[index] / top * height).rounded()))
            .frame(height: height, alignment: .bottom)
          if let labels, labels.indices.contains(index) {
            Text(labels[index])
              .font(.system(size: 11, weight: index == values.count - 1 ? .bold : .medium))
              .foregroundStyle(index == values.count - 1 ? .primary : .secondary)
          }
        }
        .frame(maxWidth: .infinity)
      }
    }
    .accessibilityHidden(true)
  }

  private static let corners = InkCorners([4, 3, 1, 2], [3, 4, 2, 1])
}

/// The last seven days as inked circles: the days that count are filled, today's edge is in
/// full ink.
struct InkDots: View {
  let done: [Bool]
  let labels: [String]
  let tint: CommandTint
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    HStack(spacing: 0) {
      ForEach(done.indices, id: \.self) { index in
        let today = index == done.count - 1
        VStack(spacing: 3) {
          let shape = InkShape(corners: .round, wobble: 0.3, seed: index * 7)
          shape
            .fill(done[index] ? (style == .fullColor ? markFill(tint) : Color.primary) : .clear)
            .overlay(
              shape.stroke(today ? Color.primary : InkColor.line, lineWidth: today ? 1.6 : 1.2)
            )
            .frame(width: 12, height: 12)
          if labels.indices.contains(index) {
            Text(labels[index])
              .font(.system(size: 11, weight: today ? .bold : .medium))
              .foregroundStyle(today ? .primary : .secondary)
          }
        }
        .frame(maxWidth: .infinity)
      }
    }
    .accessibilityHidden(true)
  }
}

/// How much is done, as an inked bar filled with the highlighter.
struct InkMeter: View {
  let fraction: Double
  let tint: CommandTint
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    let shape = InkShape(corners: InkCorners([6, 4, 7, 3], [4, 7, 3, 6]), wobble: 0.3, seed: 19)
    GeometryReader { proxy in
      Rectangle()
        .fill(style == .fullColor ? markFill(tint) : Color.primary)
        .frame(width: proxy.size.width * min(1, max(0, fraction)))
    }
    .clipShape(shape)
    .overlay(shape.stroke(InkColor.line, lineWidth: 1.1))
    .frame(height: 10)
    .accessibilityHidden(true)
  }
}

/// A widget button inked by hand: the highlighter inside a drawn edge.
struct GlanceButtonStyle: ButtonStyle {
  let tint: CommandTint
  @Environment(\.miniAppGlanceStyle) private var style

  func makeBody(configuration: Configuration) -> some View {
    let shape = InkShape(corners: InkCorners([19, 15, 20, 14], [15, 20, 14, 19]), seed: 29)
    configuration.label
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(.primary)
      .frame(maxWidth: .infinity, minHeight: 36)
      .background {
        shape.fill(style == .fullColor ? markFill(tint) : Color.clear)
        shape.stroke(InkColor.line, lineWidth: 1.1)
      }
      .scaleEffect(configuration.isPressed ? 0.96 : 1)
  }
}

/// The big number of a glance with its unit beside it, smaller.
struct BigValue: View {
  let value: String
  var unit: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      Text(value)
        .font(.system(size: 30, weight: .bold))
        .tracking(-0.6)
      if let unit, !unit.isEmpty {
        Text(unit)
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(.secondary)
      }
    }
    .monospacedDigit()
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }
}

extension Text {
  /// The small line above a glance's number (本月支出, 已打包).
  func kicker() -> some View {
    font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
  }

  /// The line under a glance's number (今天 ¥68 · 3 笔).
  func sub() -> some View {
    font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
      .monospacedDigit()
  }

  func caption() -> some View {
    font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
  }
}
