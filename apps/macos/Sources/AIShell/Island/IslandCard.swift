import AICore
import AppKit
import SwiftUI

/// The options card (``OptionsCard``) the island grows into: the mini panel's commands card
/// (18 pt corner, 28 pt rows on 8 pt washes) with a title, a filter field for a long list, and a
/// footer of key hints beside the Run button. Keys reach the card through its window
/// (``IslandController``), the pointer through its rows; both change the card through the
/// model, so the highlight is one and the same. Option labels and values are user data, shown
/// untranslated and cut with an ellipsis.
///
/// `width` nil lays out every row at its ideal width, which is how the controller measures the
/// card; the card itself is drawn `width` wide with its visible rows only.
struct IslandCard: View {
  let model: IslandModel
  let command: String
  let card: OptionsCard
  /// The card that has the pointer and the keyboard; a leaving one is inert.
  let active: Bool
  var width: Double?
  @FocusState private var filterFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      title
      if card.showsFilter { filter.padding(.bottom, IslandMetrics.sectionGap) }
      rows
      footer.padding(.top, IslandMetrics.sectionGap)
    }
    .padding(IslandMetrics.cardPadding)
    .frame(width: width.map { CGFloat($0) }, alignment: .topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.options(command)))
  }

  private var title: some View {
    let text = card.choice.map { card.page == .list ? command : $0.label } ?? command
    return Text(verbatim: text)
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(.secondary)
      .lineLimit(1)
      .truncationMode(.tail)
      .padding(.horizontal, IslandMetrics.rowPadding)
      .frame(height: IslandMetrics.headerHeight, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }

  private var filter: some View {
    let text = Binding(get: { card.filter }, set: { model.cardEvent(.filter($0)) })
    return TextField(text: text, prompt: Text(verbatim: model.labels.filter)) {
      Text(verbatim: model.labels.filter)
    }
    .textFieldStyle(.plain)
    .font(.system(size: 13))
    .focused($filterFocused)
    .disabled(!active)
    .padding(.horizontal, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.filterHeight)
    .background {
      IslandWash(
        level: 0.06,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.rowRadius, style: .continuous))
    }
    // The card arrives hidden and becomes active a frame later, and its window may take the
    // keyboard after that: the field takes focus once both hold.
    .onChange(of: active && model.cardIsKey, initial: true) { _, focus in filterFocused = focus }
  }

  @ViewBuilder private var rows: some View {
    let rows = card.rows
    let shown = width == nil ? rows.indices : card.visible
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(shown), id: \.self) { index in
        IslandCardRow(
          model: model, row: rows[index], index: index,
          selected: index == card.selection && rows[index] != .noMatch, active: active)
      }
    }
    .frame(
      height: width == nil ? nil : Double(card.capacity) * IslandMetrics.rowHeight,
      alignment: .top)
  }

  private var footer: some View {
    let labels = model.labels
    return HStack(spacing: 10) {
      switch card.page {
      case .list:
        IslandKeyHint(keys: "↑↓", label: labels.keyMove)
        IslandKeyHint(keys: "1–9", label: labels.keyPick)
        IslandKeyHint(keys: "esc", label: labels.keyClose)
      case .sheet:
        IslandKeyHint(keys: "↑↓", label: labels.keyMove)
        IslandKeyHint(keys: "←→", label: labels.keyChange)
        IslandKeyHint(keys: "␣", label: labels.keyOpen)
        IslandKeyHint(keys: "esc", label: labels.keyClose)
      case .drill:
        IslandKeyHint(keys: "↑↓", label: labels.keyMove)
        IslandKeyHint(keys: "↩", label: labels.keyPick)
        IslandKeyHint(keys: "⌘[", label: labels.keyBack)
      }
      Spacer(minLength: 8)
      if !isDrillDown {
        IslandTextButton(title: labels.run, rest: 0.08, action: { model.cardEvent(.run) }) {
          IslandKeycap(symbol: "↩")
        }
      }
    }
    .padding(.leading, 4)
    .frame(height: IslandMetrics.footerHeight)
  }

  /// A drill-down returns its pick to the sheet, so it has no Run button.
  private var isDrillDown: Bool {
    if case .drill = card.page { return true }
    return false
  }
}

/// A row of the card: a value of a list (a check on the current one and its number for 1–9, both
/// at the trailing edge, where every mark of the card sits), or an option of a sheet with what it
/// shows now (a choice's value, a toggle's check, the panel hand-off of an input). The highlight is the card's selection, which the pointer moves too.
private struct IslandCardRow: View {
  let model: IslandModel
  let row: OptionsCard.Row
  let index: Int
  let selected: Bool
  let active: Bool

  var body: some View {
    if case .noMatch = row {
      Text(verbatim: model.labels.noMatch)
        .font(IslandType.label)
        .foregroundStyle(.secondary)
        .padding(.horizontal, IslandMetrics.rowPadding)
        .frame(height: IslandMetrics.rowHeight, alignment: .leading)
    } else {
      Button {
        model.cardEvent(.click(index))
      } label: {
        HStack(spacing: 8) {
          Text(verbatim: label)
            .font(IslandType.label)
            .lineLimit(1)
            .truncationMode(.tail)
          Spacer(minLength: 8)
          trailing
        }
        .padding(.horizontal, IslandMetrics.rowPadding)
        .frame(height: IslandMetrics.rowHeight)
      }
      .buttonStyle(
        IslandWashStyle(
          shape: RoundedRectangle(cornerRadius: IslandMetrics.rowRadius, style: .continuous),
          hovered: false, rest: selected ? 0.1 : 0)
      )
      .foregroundStyle(.primary)
      .onHover { inside in
        if inside, active { model.cardEvent(.hover(index)) }
      }
      .accessibilityLabel(Text(verbatim: label))
      .accessibilityValue(Text(verbatim: value))
      .accessibilityAddTraits(selected ? .isSelected : [])
    }
  }

  private var label: String {
    switch row {
    case .value(let value, _): value.label
    case .option(let option): OptionsCard.label(of: option)
    case .noMatch: ""
    }
  }

  /// What VoiceOver reads as the row's value.
  private var value: String {
    switch row {
    case .option(.choice(let choice)): OptionsCard.valueLabel(of: choice)
    case .option(.input): model.labels.edit
    default: ""
    }
  }

  @ViewBuilder private var trailing: some View {
    switch row {
    case .value(_, let current):
      HStack(spacing: 8) {
        IslandGlyph(name: "check").opacity(current ? 1 : 0)
        if index < 9 {
          Text(verbatim: String(index + 1))
            .font(IslandType.hint)
            .foregroundStyle(.tertiary)
            .monospacedDigit()
        }
      }
    case .option(.choice(let choice)):
      Text(verbatim: OptionsCard.valueLabel(of: choice))
        .font(IslandType.label)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
    case .option(.toggle(let toggle)):
      IslandGlyph(name: "check").opacity(toggle.value ? 1 : 0)
    case .option(.input):
      HStack(spacing: 4) {
        Text(verbatim: model.labels.edit).font(IslandType.hint).lineLimit(1)
        IslandGlyph(name: "arrow-up-right", side: 12)
      }
      .foregroundStyle(.secondary)
      .fixedSize()
    case .noMatch:
      EmptyView()
    }
  }
}
