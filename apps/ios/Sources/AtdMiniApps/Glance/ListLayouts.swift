import AppIntents
import AtdInk
import SwiftUI

/// 露营清单 and other checklists: how many are ticked, and (medium) the next ones as rows that
/// tick in place without opening Atd.
struct ChecklistGlance: View {
  let head: MiniAppGlance.Head
  let checklist: MiniAppGlance.Checklist
  let medium: Bool
  let label: String

  var body: some View {
    if medium {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 0) {
          GlanceHead(head: head)
          Spacer(minLength: 4)
          summary
        }
        .frame(width: 112, alignment: .leading)
        .glanceLabel(label)
        if checklist.rows.isEmpty {
          VStack(spacing: 6) {
            Image(systemName: "checkmark.circle").font(.system(size: 26, weight: .medium))
            Text(checklist.finished).font(.system(size: 15, weight: .semibold))
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityElement(children: .combine)
        } else {
          VStack(spacing: 5) {
            ForEach(checklist.rows) { row in
              Toggle(
                isOn: row.done,
                intent: MiniAppCheckIntent(checklist.toggle, recordID: row.id, value: !row.done)
              ) {
                Text(row.label)
              }
              .toggleStyle(TickToggleStyle())
            }
            Spacer(minLength: 0)
          }
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 0) {
        GlanceHead(head: head)
        Spacer(minLength: 4)
        summary
        Text(checklist.sub).sub()
      }
      .glanceLabel(label)
    }
  }

  private var summary: some View {
    VStack(alignment: .leading, spacing: 0) {
      BigValue(value: "\(checklist.done)", unit: "/\(checklist.total)")
      Text(checklist.kicker).kicker()
      InkMeter(
        fraction: checklist.total == 0 ? 0 : Double(checklist.done) / Double(checklist.total),
        tint: head.tint
      )
      .padding(.vertical, 5)
    }
  }
}

/// A checklist row: an inked circle ticked over green, inside a hand-drawn edge.
struct TickToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      TickRow(isOn: configuration.isOn) { configuration.label }
    }
    .buttonStyle(.plain)
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }
}

private struct TickRow<Label: View>: View {
  let isOn: Bool
  @ViewBuilder let label: Label
  @Environment(\.miniAppGlanceStyle) private var style

  var body: some View {
    let edge = InkShape(corners: InkCorners([14, 11, 15, 10], [11, 15, 10, 14]), seed: 37)
    let box = InkShape(corners: .round, wobble: 0.3, seed: 41)
    HStack(spacing: 10) {
      ZStack {
        box.fill(isOn ? (style == .fullColor ? InkColor.on : Color.primary) : Color.clear)
        box.stroke(InkColor.line, lineWidth: 1.4)
        if isOn {
          Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy))
            .foregroundStyle(style == .fullColor ? Color.primary : InkColor.paper)
        }
      }
      .frame(width: 22, height: 22)
      label
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(isOn ? .secondary : .primary)
        .strikethrough(isOn)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.leading, 9)
    .padding(.trailing, 12)
    .frame(height: 40)
    .background { edge.stroke(InkColor.line, lineWidth: 1.1) }
    .contentShape(Rectangle())
  }
}

/// One number: a field, part of a daily series or days until a date.
struct StatGlance: View {
  let head: MiniAppGlance.Head
  let stat: MiniAppGlance.Stat
  let medium: Bool

  var body: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 0) {
        GlanceHead(head: head)
        Spacer(minLength: 4)
        if !stat.kicker.isEmpty { Text(stat.kicker).kicker() }
        BigValue(value: stat.value, unit: stat.unit)
        if let sub = stat.sub { Text(sub).sub() }
        if !medium, let bars = stat.bars {
          InkBars(values: bars, height: 20, tint: head.tint).padding(.top, 8)
        }
      }
      if medium, let bars = stat.bars {
        VStack {
          Spacer(minLength: 0)
          InkBars(values: bars, height: 64, labels: stat.barLabels, fillsAll: true, tint: head.tint)
        }
      }
    }
  }
}

/// The latest records, newest first.
struct RowsGlance: View {
  let head: MiniAppGlance.Head
  let rows: MiniAppGlance.Rows
  let medium: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      GlanceHead(head: head)
      Text(rows.kicker).kicker()
      if rows.rows.isEmpty {
        Spacer(minLength: 0)
        Text(rows.empty).sub()
      } else {
        ForEach(rows.rows.prefix(medium ? 4 : 3)) { row in
          HStack(spacing: 8) {
            Text(row.title)
              .font(.system(size: 13, weight: .medium))
              .lineLimit(1)
              .frame(maxWidth: .infinity, alignment: .leading)
            if let trailing = row.trailing {
              Text(trailing).sub()
            }
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}
