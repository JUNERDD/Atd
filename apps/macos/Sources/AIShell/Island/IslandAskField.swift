import AICore
import SwiftUI

/// Asking about a shell card's capture in place (R10, D11): a field with Send, and the card's
/// quick asks under it, each sending its question. Return in the field sends what was typed, or
/// the card's own question when nothing was; the quick ask whose answer shows is marked. Every
/// ask goes on the range kept now (``IslandAsking/ask(_:quick:)``). The recording's result card
/// and the long screenshot's share it.
struct IslandAskField<Ask: CardAsk, Quick: IslandQuickAsk>: View {
  let asking: IslandAsking<Ask, Quick>
  let labels: IslandAskLabels<Quick>
  let width: Double
  let quickAsksHeight: Double
  @FocusState private var focused: Bool
  @State private var sendHovered = false

  var body: some View {
    let width =
      width - IslandMetrics.cardPadding * 2 - IslandMetrics.recordingInset * 2
    let rows = labels.quickRows(width: width)
    VStack(alignment: .leading, spacing: IslandMetrics.recordingQuickAskGap) {
      field
        .padding(.top, IslandMetrics.recordingAskTop)
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          HStack(spacing: 6) {
            ForEach(row, id: \.self) { quick in
              IslandQuickAskChip(
                title: labels.question(quick), on: asking.answers.shown?.quick == quick
              ) { asking.ask(labels.question(quick), quick: quick) }
            }
          }
        }
      }
      .frame(
        height: quickAsksHeight,
        alignment: .top)
    }
  }

  private var field: some View {
    let binding = Binding(get: { asking.question }, set: { asking.question = $0 })
    return HStack(spacing: 6) {
      IslandGlyph(name: IslandIcons.sparkles, side: 14).foregroundStyle(.secondary)
      TextField(text: binding, prompt: Text(verbatim: labels.askPlaceholder)) {
        Text(verbatim: labels.askLabel)
      }
      .textFieldStyle(.plain)
      .font(IslandType.answer)
      .focused($focused)
      .onSubmit { send() }
      .accessibilityLabel(Text(verbatim: labels.askLabel))
      Button {
        send()
      } label: {
        IslandGlyph(name: IslandIcons.send)
          .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
      }
      .buttonStyle(IslandAskSendStyle(hovered: sendHovered))
      .modifier(FloatingHover { sendHovered = $0 })
      .help(labels.send + " ↩")
      .accessibilityLabel(Text(verbatim: labels.send))
    }
    .padding(.leading, 10)
    .padding(.trailing, 2)
    .frame(height: IslandMetrics.recordingAskHeight)
    .background { IslandWash(level: 0.06, shape: Capsule()) }
  }

  private func send() {
    let typed = asking.question.trimmingCharacters(in: .whitespacesAndNewlines)
    asking.question = ""
    asking.ask(typed.isEmpty ? labels.askDefault : typed)
  }
}

/// How the quick asks wrap under the field, `width` points wide: the measured native labels wrap
/// without reducing the chip font or control height.
extension IslandAskLabels {
  func quickHeight(width: Double) -> Double {
    let count = Double(quickRows(width: width).count)
    return count * IslandMetrics.recordingQuickAskHeight + max(count - 1, 0) * 6
  }

  fileprivate func quickRows(width: Double) -> [[Quick]] {
    var rows: [[Quick]] = [[]]
    var used = 0.0
    for quick in Quick.allCases {
      let item =
        IslandType.width(
          of: question(quick), size: 12, weight: .regular, limit: .greatestFiniteMagnitude)
        + 20
      let gap = used > 0 ? 6.0 : 0
      if used > 0, used + gap + item > width {
        rows.append([quick])
        used = item
      } else {
        rows[rows.count - 1].append(quick)
        used += gap + item
      }
    }
    return rows
  }
}

/// The ask field's send button in the command cards' colours, as the review card's send button
/// (``IslandReviewSendButton``) once it has something to send, which this one always has: a
/// circle filled with the label colour, its arrow in the opposite one, lighter while hovered and
/// pressed. The focus probe keeps Space with a focused button instead of Play.
private struct IslandAskSendStyle: ButtonStyle {
  let hovered: Bool

  func makeBody(configuration: Configuration) -> some View {
    IslandAskSendLabel(configuration: configuration, hovered: hovered)
  }
}

private struct IslandAskSendLabel: View {
  let configuration: ButtonStyleConfiguration
  let hovered: Bool
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    configuration.label
      .foregroundStyle(scheme == .dark ? Color.black : Color.white)
      .background {
        Circle().fill(Color.primary.opacity(configuration.isPressed ? 0.7 : hovered ? 0.85 : 1))
      }
      .background { IslandFocusProbe() }
      .contentShape(Circle())
  }
}

/// A quick ask: a small capsule on the wash, deeper while its answer shows.
private struct IslandQuickAskChip: View {
  let title: String
  let on: Bool
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      Text(verbatim: title)
        .font(IslandType.hint)
        .foregroundStyle(.primary)
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 10)
        .frame(height: IslandMetrics.recordingQuickAskHeight)
    }
    .buttonStyle(
      IslandWashStyle(
        shape: Capsule(), hovered: hovered, rest: on ? 0.16 : 0.06, hover: on ? 0.16 : 0.09)
    )
    .modifier(FloatingHover { hovered = $0 })
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}
