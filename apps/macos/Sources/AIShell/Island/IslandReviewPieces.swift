import AICore
import AppKit
import SwiftUI

/// The review card's copy in the shell language, and the options sheet's Done.
struct IslandReviewLabels: Equatable {
  var original = ""
  var showChanges = ""
  var regenerate = ""
  var previous = ""
  var next = ""
  var regenerating = ""
  var adjusting = ""
  var rerunning = ""
  var stop = ""
  var send = ""
  var placeholder = ""
  var limit = ""
  var done = ""
  var keyOptions = ""
  var keyInput = ""
  var keySelect = ""

  static func current() -> IslandReviewLabels {
    let strings = ShellStrings.shared
    return IslandReviewLabels(
      original: strings.text(.commandReviewOriginal),
      showChanges: strings.text(.commandReviewShowChanges),
      regenerate: strings.text(.commandReviewRegenerate),
      previous: strings.text(.commandReviewPrevious), next: strings.text(.commandReviewNext),
      regenerating: strings.text(.commandReviewRegenerating),
      adjusting: strings.text(.commandReviewAdjusting),
      rerunning: strings.text(.commandReviewRerunning), stop: strings.text(.commandReviewStop),
      send: strings.text(.commandReviewSend),
      placeholder: strings.text(.commandReviewPlaceholder),
      limit: strings.text(
        .commandReviewLimit, count: CommandProgressState.Review.maxVersions),
      done: strings.text(.commandOptionsDone),
      keyOptions: strings.text(.commandReviewKeyOptions),
      keyInput: strings.text(.commandReviewKeyInput),
      keySelect: strings.text(.commandReviewKeySelect))
  }

  /// What the header says while the next version is being made, by what asked for it.
  func pending(_ pending: CommandProgressState.Review.Pending) -> String {
    switch pending {
    case .regenerate: regenerating
    case .adjust: adjusting
    case .options: rerunning
    }
  }

  /// The empty field's placeholder while `count` changes are staged.
  func staged(_ count: Int) -> String {
    ShellStrings.shared.text(.commandReviewPlaceholderStaged, count: count)
  }
}

/// The text the run read in place of the selection, above the answer: a 2 pt bar in a faint
/// label colour beside the Original label and the text, in the hint type, cut to
/// ``IslandMetrics/reviewSourceLines`` lines. Where the review has the answer's changes, the
/// label row has the Show changes switch, and the text gives way while they show, since the
/// marked answer then holds it. Both come and go in place, on the spring the card's shape takes
/// for the same change, so the answer under them never jumps (a version with changes after one
/// without, or the switch itself).
struct IslandReviewSource: View {
  let model: IslandModel
  let source: String
  /// The review marks the answer's changes against the source: the switch shows.
  let changes: Bool

  var body: some View {
    let labels = model.labels.review
    let showing = changes && model.review.showsChanges
    let change = IslandChoreography.inPlace.length.animation
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(verbatim: labels.original)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.tertiary)
          .accessibilityAddTraits(.isHeader)
        Spacer(minLength: 8)
        Toggle(
          isOn: Binding(
            get: { model.review.showsChanges }, set: { model.reviewEvent(.showChanges($0)) })
        ) {
          Text(verbatim: labels.showChanges)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        .disabled(!changes)
        .accessibilityHidden(!changes)
        .islandRevealed(changes, clips: false, animation: change)
      }
      Text(verbatim: source)
        .font(IslandType.hint)
        .foregroundStyle(.secondary)
        .lineLimit(IslandMetrics.reviewSourceLines)
        .truncationMode(.tail)
        .fixedSize(horizontal: false, vertical: true)
        .frame(
          maxWidth: IslandMetrics.resultTextWidth - 9 - IslandMetrics.rowPadding * 2,
          alignment: .leading
        )
        .padding(.top, 2)
        .accessibilityHidden(showing)
        .islandRevealed(!showing, animation: change)
    }
    .padding(.leading, 9)
    .padding(.vertical, 2)
    .overlay(alignment: .leading) {
      Rectangle().fill(Color.primary.opacity(0.16)).frame(width: 2).accessibilityHidden(true)
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
    .padding(.top, 2)
    .padding(.bottom, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The answer marked against the original: what it adds on a green wash, what it drops in red,
/// struck through, on a red wash; the rest as it is. Selectable, as the plain answer is
/// (``IslandAnswerText``).
struct IslandReviewMarkedAnswer: View {
  let changes: [CommandProgressState.Review.Change]

  var body: some View {
    Text(Self.marked(changes))
      .font(IslandType.answer)
      .foregroundStyle(.primary)
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, IslandMetrics.rowPadding)
      .frame(maxWidth: IslandMetrics.resultTextWidth, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  static func marked(_ changes: [CommandProgressState.Review.Change]) -> AttributedString {
    changes.reduce(into: AttributedString()) { text, change in
      var run = AttributedString(change.text)
      switch change.kind {
      case .same: break
      case .insert: run.backgroundColor = Color.green.opacity(0.24)
      case .delete:
        run.foregroundColor = Color.red
        run.backgroundColor = Color.red.opacity(0.14)
        run.strikethroughStyle = .single
      }
      text += run
    }
  }
}

/// A chip of the review card: 24 pt, 12 pt medium, on a faint wash, deeper and with a check while
/// `selected` (a staged value or adjustment), ringed while the keyboard highlights it (`focused`).
/// Nothing it does runs: it stages.
struct IslandReviewChip: View {
  let title: String
  let selected: Bool
  var focused = false
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        if selected { IslandGlyph(name: "check", side: 12) }
        Text(verbatim: title).font(IslandChipStyle.font).lineLimit(1).truncationMode(.tail)
      }
      .padding(.horizontal, 9)
      .frame(height: IslandMetrics.reviewChipHeight)
    }
    .buttonStyle(IslandChipStyle(selected: selected, hovered: hovered, focused: focused))
    .foregroundStyle(.primary)
    .modifier(FloatingHover { hovered = $0 })
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// The chip that stands for a version's options when they are not one short choice: the sliders
/// glyph (a dot, and the chip filled, while changed values are staged), the values summary cut
/// to ``IslandMetrics/reviewSummaryWidth``, and a chevron; a click (or ⌘K) opens the options
/// sheet.
struct IslandReviewSummaryChip: View {
  let summary: String
  let staged: Bool
  let label: String
  var focused = false
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    // The glyph, the chevron, their gaps and the padding take 50 pt of the chip's widest.
    let limit = IslandMetrics.reviewSummaryWidth - 50
    Button(action: action) {
      HStack(spacing: 4) {
        if staged {
          Circle().fill(Color.accentColor).frame(width: 6, height: 6).padding(.horizontal, 3)
        } else {
          IslandGlyph(name: IslandIcons.options, side: 12)
        }
        Text(verbatim: summary)
          .font(IslandChipStyle.font)
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(width: IslandType.width(of: summary, size: 12, limit: limit), alignment: .leading)
        IslandGlyph(name: IslandIcons.expand, side: 12)
      }
      .padding(.horizontal, 9)
      .frame(height: IslandMetrics.reviewChipHeight)
    }
    .buttonStyle(IslandChipStyle(selected: staged, hovered: hovered, focused: focused))
    .foregroundStyle(.primary)
    .modifier(FloatingHover { hovered = $0 })
    .help(label + " ⌘K")
    .accessibilityLabel(Text(verbatim: label))
    .accessibilityValue(Text(verbatim: summary))
  }
}

/// The chips' capsule washes: faint at rest, deeper while selected, lighter on hover only where
/// that adds to the rest, deepest while pressed. While `focused` a 2 pt ring in the system's
/// keyboard focus colour hugs the chip outside its edge, apart from the washes, so the keyboard
/// highlight never reads as a selection or a hover.
struct IslandChipStyle: ButtonStyle {
  static let font = Font.system(size: 12, weight: .medium)

  let selected: Bool
  let hovered: Bool
  var focused = false

  func makeBody(configuration: Configuration) -> some View {
    let rest = selected ? 0.17 : 0.06
    let level = configuration.isPressed ? rest + 0.06 : hovered ? max(rest, 0.11) : rest
    configuration.label
      .background { IslandWash(level: level, shape: Capsule()) }
      .overlay {
        if focused {
          Capsule().inset(by: -2)
            .strokeBorder(Color(nsColor: .keyboardFocusIndicatorColor), lineWidth: 2)
            .accessibilityHidden(true)
        }
      }
      .contentShape(Capsule())
  }
}

/// The adjust field's send button: a 24 pt capsule, faint and dimmed while there is nothing to
/// send, filled with the label colour and its text in the opposite one once there is. Its
/// tooltip is its name with Return, unless `tooltip` says why it rests.
struct IslandReviewSendButton: View {
  let ready: Bool
  let label: String
  var tooltip: String?
  let action: () -> Void
  @State private var hovered = false
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    Button(action: action) {
      Text(verbatim: label)
        .font(IslandType.hint.weight(.semibold))
        .lineLimit(1)
        .foregroundStyle(ready ? (scheme == .dark ? Color.black : Color.white) : Color.primary)
        .padding(.horizontal, 10)
        .frame(height: IslandMetrics.reviewSendHeight)
        .fixedSize(horizontal: true, vertical: false)
        .background {
          Capsule().fill(Color.primary.opacity(ready ? (hovered ? 0.85 : 1) : 0.14))
        }
    }
    .buttonStyle(.plain)
    .disabled(!ready)
    .opacity(ready ? 1 : 0.4)
    .modifier(FloatingHover(enabled: ready) { hovered = $0 })
    .help(tooltip ?? label + " ↩")
    .accessibilityLabel(Text(verbatim: label))
  }
}

/// Lays chips or whole action buttons out in rows that wrap at the width offered, ``spacing``
/// apart along and between rows, each row as tall as its tallest item. Items stay vertically
/// centred; the row follows ``alignment``. Offered no width, it lays them out in one row.
struct IslandChipFlow: Layout {
  var spacing = IslandMetrics.reviewChipGap
  var alignment = HorizontalAlignment.leading

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrange(width: proposal.width, subviews).size
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    for (subview, frame) in zip(subviews, arrange(width: bounds.width, subviews).frames) {
      subview.place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(frame.size))
    }
  }

  private func arrange(width: CGFloat?, _ subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
    let width = width.flatMap { $0.isFinite ? max($0, 0) : nil }
    let limit = width ?? .infinity
    var rows: [[(Int, CGSize)]] = [[]]
    var rowWidth = 0.0
    for (index, subview) in subviews.enumerated() {
      var size = subview.sizeThatFits(.unspecified)
      size.width = min(size.width, limit)
      let needed = rows[rows.count - 1].isEmpty ? size.width : rowWidth + spacing + size.width
      if needed > limit, !rows[rows.count - 1].isEmpty {
        rows.append([])
        rowWidth = size.width
      } else {
        rowWidth = needed
      }
      rows[rows.count - 1].append((index, size))
    }
    var frames = Array(repeating: CGRect.zero, count: subviews.count)
    var y = 0.0
    var widest = 0.0
    for row in rows where !row.isEmpty {
      let height = row.map(\.1.height).max() ?? 0
      let rowWidth = row.reduce(0) { $0 + $1.1.width } + Double(row.count - 1) * spacing
      var x = alignment == .trailing ? max((width ?? rowWidth) - rowWidth, 0) : 0
      for (index, size) in row {
        frames[index] = CGRect(
          x: x, y: y + (height - size.height) / 2, width: size.width, height: size.height)
        x += size.width + spacing
      }
      widest = max(widest, rowWidth)
      y += height + spacing
    }
    return (frames, CGSize(width: width ?? widest, height: max(y - spacing, 0)))
  }
}
