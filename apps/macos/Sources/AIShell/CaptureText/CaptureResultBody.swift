import AICore
import SwiftUI

/// What the result card shows between its note and its footer (``CaptureResultCard/Body``) on the
/// page it shows (``CaptureResultCardModel/shownBody(_:)``): placeholder lines until the first
/// text, the answer as the island's answer card shows it, an explanation's lead and items, or the
/// replacements over their originals; the same whether the version shown is on the image or
/// previews there under review. The page of a version being made shows it as it grows; its rows
/// are not on the image yet, so they neither light nor flash anything there.
///
/// `measuring` lays out at most ``CaptureResultMeasure/measuredLength`` of an answer and
/// ``CaptureResultMeasure/measuredRows`` replacements: more scrolls in the card at any rate, so
/// measuring the rest would only cost time.
struct CaptureResultBody: View {
  let model: CaptureResultCardModel
  let card: CaptureResultCard
  var measuring = false

  var body: some View {
    let live = !model.showsDraft(card)
    switch model.shownBody(card) {
    case .none:
      EmptyView()
    case .skeleton:
      CaptureResultSkeleton()
    case .answer(let text):
      IslandAnswerText(
        text: measuring ? String(text.prefix(CaptureResultMeasure.measuredLength)) : text)
    case .items(let lead, let entries):
      CaptureResultItems(model: model, lead: lead, entries: entries, live: live)
    case .replacements(let rows):
      CaptureResultReplacements(model: model, rows: rows, measuring: measuring, live: live)
    }
  }
}

/// An explanation's lead, then its items.
private struct CaptureResultItems: View {
  let model: CaptureResultCardModel
  let lead: String
  let entries: [CaptureResultCard.Entry]
  let live: Bool

  var body: some View {
    let hotItem = live ? model.hotItem : nil
    let inView = live ? model.inView : []
    let stepColor = model.stepColor
    let itemGoneLabel = model.labels.itemGone
    VStack(alignment: .leading, spacing: 6) {
      if !lead.isEmpty { IslandAnswerText(text: lead) }
      VStack(alignment: .leading, spacing: 2) {
        ForEach(entries) { entry in
          CaptureResultItem(
            model: model, entry: entry, live: live, stepColor: stepColor,
            itemGoneLabel: itemGoneLabel, isHot: hotItem == entry.id,
            isInView: inView.contains(entry.id)
          )
          .equatable()
        }
      }
      .padding(.horizontal, 2)
    }
  }
}

/// Each replacement over its original, the paragraph's own row (``CaptureResultRow``): the new
/// text in the answer type, then the recognized text it replaced in the hint type and the
/// secondary colour, two lines at most (the row's tooltip, and ⌥ on the image, show all of it). A
/// translation is read for its new text, so that leads; the original under it is there to check it
/// against. Rows stack lazily, since a long screenshot's whole text can be hundreds of paragraphs;
/// measured, the first few stand eagerly.
private struct CaptureResultReplacements: View {
  let model: CaptureResultCardModel
  let rows: [CaptureResultCard.Replacement]
  let measuring: Bool
  let live: Bool

  var body: some View {
    let hotItem = live && !measuring ? model.hotItem : nil
    let inView = live && !measuring ? model.inView : []
    Group {
      if measuring {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(rows.prefix(CaptureResultMeasure.measuredRows)) {
            row($0, hotItem: hotItem, inView: inView)
          }
        }
      } else {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(rows) { row($0, hotItem: hotItem, inView: inView) }
        }
      }
    }
    .padding(.horizontal, 2)
  }

  private func row(_ row: CaptureResultCard.Replacement, hotItem: Int?, inView: Set<Int>)
    -> some View
  {
    CaptureResultReplacementRow(
      model: model, row: row, live: live, isHot: hotItem == row.id,
      isInView: inView.contains(row.id)
    )
    .equatable()
  }
}

/// One replacement row over its original, equatable so hover/viewport shifts rebuild only affected rows.
private struct CaptureResultReplacementRow: View, Equatable {
  let model: CaptureResultCardModel
  let row: CaptureResultCard.Replacement
  let live: Bool
  let isHot: Bool
  let isInView: Bool

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.model === rhs.model && lhs.row == rhs.row && lhs.live == rhs.live
      && lhs.isHot == rhs.isHot && lhs.isInView == rhs.isInView
  }

  var body: some View {
    CaptureResultRow(
      model: model, item: row.id, live: live, isHot: isHot, isInView: isInView,
      tooltip: row.original
    ) {
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: row.text)
          .font(IslandType.answer)
          .foregroundStyle(.primary)
        Text(verbatim: row.original)
          .font(IslandType.hint)
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .truncationMode(.tail)
      }
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityLabel(Text(verbatim: row.text))
    .accessibilityHint(Text(verbatim: row.original))
  }
}

/// One row of the card's lists (an explanation's item, a replacement), a plain button on the
/// faint wash: lit while it or its place on the image is hovered
/// (``CaptureResultCardModel/hotItem``), fainter while the host's media shows its place
/// (``CaptureResultCardModel/inView``). Hovering it lights its paragraph on the image and a click
/// flashes it (in the long screenshot, the image also scrolls to it) (``CaptureResultAction``).
/// A row of a version being made (not `live`) has no place on the image yet: it is laid out the
/// same, without the button.
private struct CaptureResultRow<Label: View>: View {
  let model: CaptureResultCardModel
  /// The item's index in the run (in the version being made, when not `live`).
  let item: Int
  let live: Bool
  let isHot: Bool
  let isInView: Bool
  var tooltip = ""
  @ViewBuilder let label: () -> Label

  var body: some View {
    if live {
      let level = isHot ? 0.09 : isInView ? 0.05 : 0
      Button {
        model.pick(item)
      } label: {
        row(level: level)
      }
      .buttonStyle(.plain)
      .modifier(FloatingHover { model.hover(item, inside: $0) })
      .help(tooltip)
    } else {
      row(level: 0).help(tooltip)
    }
  }

  private func row(level: Double) -> some View {
    let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
    return label()
      .padding(.horizontal, 6)
      .padding(.vertical, 4)
      .background { IslandWash(level: level, shape: shape) }
      .contentShape(shape)
  }
}

/// Two placeholder lines on the faint wash, the second shorter, until the first text arrives;
/// the note's spinner says the run is working.
private struct CaptureResultSkeleton: View {
  /// The second line: about three fifths of the card's text width.
  private static let shortLine =
    (CaptureResultPlacement.cardWidth - (IslandMetrics.cardPadding + IslandMetrics.rowPadding) * 2)
    * 0.62

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      IslandWash(level: 0.08, shape: Capsule()).frame(height: 10)
      IslandWash(level: 0.08, shape: Capsule()).frame(width: Self.shortLine, height: 10)
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityHidden(true)
  }
}

/// One item of an explanation (``CaptureResultRow``): its badge, numbered as its step marker on
/// the image (a hollow one until the marker lands; the highlighter's glyph for a highlighter note),
/// and its words. An item whose marker was deleted from the image dims, and says ⌘Z brings it back.
private struct CaptureResultItem: View, Equatable {
  let model: CaptureResultCardModel
  let entry: CaptureResultCard.Entry
  let live: Bool
  let stepColor: AnnotationColor
  let itemGoneLabel: String
  let isHot: Bool
  let isInView: Bool

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.model === rhs.model && lhs.entry == rhs.entry && lhs.live == rhs.live
      && lhs.stepColor == rhs.stepColor && lhs.itemGoneLabel == rhs.itemGoneLabel
      && lhs.isHot == rhs.isHot && lhs.isInView == rhs.isInView
  }

  var body: some View {
    let gone = entry.marker == .gone
    CaptureResultRow(
      model: model, item: entry.id, live: live, isHot: isHot, isInView: isInView,
      tooltip: gone ? itemGoneLabel : ""
    ) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        badge
        Text(verbatim: entry.text)
          .font(IslandType.answer)
          .foregroundStyle(.primary)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .opacity(gone ? 0.45 : 1)
    .accessibilityLabel(Text(verbatim: accessibilityText))
  }

  private static let side: CGFloat = 18

  @ViewBuilder private var badge: some View {
    let color = Color(nsColor: stepColor.nsColor)
    Group {
      switch entry.marker {
      case .number(let number):
        Text(verbatim: "\(number)")
          .font(.system(size: 11, weight: .bold))
          .monospacedDigit()
          .foregroundStyle(.white)
          .frame(width: Self.side, height: Self.side)
          .background { Circle().fill(color) }
      case .gone:
        Circle().fill(color).frame(width: Self.side, height: Self.side)
      case .pending:
        Circle().strokeBorder(color, lineWidth: 1.5).frame(width: Self.side, height: Self.side)
      case .highlight:
        IslandGlyph(name: "highlighter", side: 14)
          .foregroundStyle(.secondary)
          .frame(width: Self.side, height: Self.side)
      }
    }
    .alignmentGuide(.firstTextBaseline) { $0.height * 0.72 }
    .accessibilityHidden(true)
  }

  private var accessibilityText: String {
    switch entry.marker {
    case .number(let number): "\(number). \(entry.text)"
    case .gone: itemGoneLabel + " " + entry.text
    case .pending, .highlight: entry.text
    }
  }
}
