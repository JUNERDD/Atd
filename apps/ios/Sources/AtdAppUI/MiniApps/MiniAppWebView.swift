import AtdInk
import SwiftUI
import WebKit

/// A mini app's page, drawn on the sheet's paper: the page has no background of its own, its
/// cards are inked by the kit, and it scrolls itself so its fields stay above the keyboard.
struct MiniAppWebView: View {
  let host: MiniAppPageHost
  let label: String
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if host.isMissing {
        Text(MiniAppText.string("page.missing"))
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        WebView(host.page)
          .webViewContentBackground(.hidden)
          .webViewLinkPreviews(.disabled)
          .webViewElementFullscreenBehavior(.disabled)
          .webViewMagnificationGestures(.disabled)
          .webViewBackForwardNavigationGestures(.disabled)
          .accessibilityLabel(label)
      }
    }
    .alert(
      host.dialogs.current?.message ?? "", isPresented: dialogShown,
      presenting: host.dialogs.current
    ) { dialog in
      if dialog.asks {
        Button(MiniAppText.string("dialog.cancel"), role: .cancel) { host.dialogs.answer(false) }
        Button(AppText.string("action.ok")) { host.dialogs.answer(true) }
      } else {
        Button(AppText.string("action.ok"), role: .cancel) { host.dialogs.answer(true) }
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await host.revive() } }
    }
  }

  private var dialogShown: Binding<Bool> {
    Binding(
      get: { host.dialogs.current != nil },
      set: { if !$0, host.dialogs.current != nil { host.dialogs.answer(false) } })
  }
}

/// A green highlighter line with one action at its end: `「X」存好了`, `<what changed> · 撤销`,
/// `这个小应用出错了 · 修复`.
struct MiniAppFlash: View {
  let text: String
  var symbol = "checkmark.circle"
  var action: InkAction?

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .accessibilityHidden(true)
      Text(text)
        .font(.subheadline.weight(.medium))
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let action {
        Button(action.label, action: action.action)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .frame(minWidth: 44, minHeight: 44)
      }
    }
    .padding(.leading, 14)
    .padding(.trailing, action == nil ? 14 : 4)
    .frame(minHeight: 44)
    .background(InkShape(corners: .block, seed: 3).fill(InkColor.on))
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isStaticText)
  }
}

/// Suggestions that fill the field with their text, for the person to send or change.
struct MiniAppChips: View {
  let label: String
  let items: [(label: String, text: String)]
  let pick: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
      ChipRows(spacing: 8) {
        ForEach(items.indices, id: \.self) { index in
          Button(items[index].label) { pick(items[index].text) }
            .font(.subheadline)
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(
              InkShape(corners: .chip, wobble: 0.5, seed: index)
                .fill(Color(uiColor: .tertiarySystemFill))
            )
            .contentShape(Rectangle().inset(by: -4))
            .buttonStyle(.plain)
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }
}

/// Lays the chips out in rows, starting a new row when the next one does not fit.
private struct ChipRows: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
    let width = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    var y = bounds.minY
    for row in rows(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.init(width: bounds.width, height: nil))
        subviews[index].place(
          at: CGPoint(x: x, y: y),
          proposal: ProposedViewSize(width: size.width, height: size.height))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.init(width: width, height: nil))
      let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      if needed > width, !row.indices.isEmpty {
        rows.append(row)
        row = Row()
      }
      row.width = row.indices.isEmpty ? min(size.width, width) : row.width + spacing + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
