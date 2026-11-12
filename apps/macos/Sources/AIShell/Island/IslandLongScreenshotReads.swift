import AICore
import SwiftUI

/// "What Atd will read" beside the preview (D11), as tall as the preview: its title with an info
/// glyph saying how Atd reads the image, one row per page of the kept range with the first lines
/// recognized on it (scrolling inside past the room), then under a rule what goes with the
/// image: the recognized lines and characters, and the sensitive items found in the kept range
/// with Cover Sensitive Info while any has no mosaic over it (decision D7: it adds mosaics, which
/// the lightbox's annotate mode can move or delete, and Restore on the title row removes). A
/// hovered row marks its page on the preview and the other way round.
struct IslandLongScreenshotReads: View {
  let card: IslandLongScreenshotCardModel
  let labels: IslandLongScreenshotLabels
  let reduceMotion: Bool

  var body: some View {
    let state = card.state
    let sensitive = state.sensitiveCounts
    let unmasked = state.unmaskedSensitiveCounts
    VStack(alignment: .leading, spacing: 2) {
      header
      ScrollView(.vertical) {
        LazyVStack(spacing: IslandMetrics.recordingStepGap) {
          ForEach(card.pages.indices, id: \.self) { index in
            IslandLongScreenshotPageRow(card: card, labels: labels, index: index)
          }
        }
      }
      .modifier(FloatingScrollEdges(reduceMotion: reduceMotion))
      Divider()
        .padding(.horizontal, IslandMetrics.rowPadding)
        .padding(.vertical, IslandMetrics.longScreenshotRuleGap)
      row(
        glyph: "scan-text",
        text: labels.recognized(lines: state.keptLines.count, characters: state.characterCount)
      ) { EmptyView() }
      if !sensitive.isEmpty {
        let covered = unmasked.isEmpty
        // The longer English label beside Cover Sensitive Info needs a second line.
        row(
          glyph: covered ? IslandIcons.reads : "scan-eye",
          text: labels.sensitive(covered ? sensitive : unmasked, covered: covered),
          secondary: covered, lines: 2
        ) {
          if let count = card.redacted {
            // The button's face, still: it says what it just did.
            IslandTextFace(title: IslandLongScreenshotLabels.covered(count), glyph: "check")
          } else if !covered {
            IslandTextButton(
              title: labels.cover, tooltip: labels.coverTooltip(unmasked), glyph: "scan-eye"
            ) { card.redact() }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.reads))
  }

  private var header: some View {
    HStack(spacing: 4) {
      Text(verbatim: labels.reads).lineLimit(1)
      IslandGlyph(name: IslandIcons.reads, side: 13)
        .help(labels.readsInfo)
        .accessibilityHidden(false)
        .accessibilityLabel(Text(verbatim: labels.readsInfo))
      Spacer(minLength: 0)
    }
    .font(IslandType.hint)
    .foregroundStyle(.secondary)
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.recordingStepsHeader)
  }

  /// One row under the rule: a glyph, its text on up to `lines` lines, cut with an ellipsis past
  /// them (the tooltip has it whole), and an action at its end. A one-line row keeps its fixed
  /// height; a longer one grows from it.
  private func row<Action: View>(
    glyph: String, text: String, secondary: Bool = false, lines: Int = 1,
    @ViewBuilder action: () -> Action
  ) -> some View {
    HStack(spacing: 8) {
      IslandGlyph(name: glyph, side: 14).foregroundStyle(.secondary)
      Text(verbatim: text)
        .font(.system(size: 13))
        .foregroundStyle(secondary ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        .lineLimit(lines)
        .truncationMode(.tail)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .help(text)
      action()
    }
    .padding(.leading, IslandMetrics.rowPadding)
    .padding(.trailing, 2)
    .frame(
      minHeight: IslandMetrics.recordingStepHeight,
      maxHeight: lines == 1 ? IslandMetrics.recordingStepHeight : nil
    )
    .accessibilityElement(children: .combine)
  }
}

/// One page: "Page N" and its first recognized lines, cut with an ellipsis (the tooltip has
/// them), on the wash while it or its part of the preview has the pointer.
private struct IslandLongScreenshotPageRow: View {
  let card: IslandLongScreenshotCardModel
  let labels: IslandLongScreenshotLabels
  let index: Int

  var body: some View {
    let page = card.pages[index]
    let name = labels.page(index + 1)
    let text = page.lines.isEmpty ? labels.noText : page.lines.joined(separator: " ")
    HStack(spacing: 8) {
      Text(verbatim: name)
        .font(IslandType.hint)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .frame(width: 44, alignment: .leading)
      Text(verbatim: text)
        .font(.system(size: 13))
        .foregroundStyle(page.lines.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.recordingStepHeight)
    .background {
      IslandWash(
        level: card.hoveredPage == index ? 0.06 : 0,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.rowRadius, style: .continuous))
    }
    .contentShape(Rectangle())
    .modifier(FloatingHover(pointer: .passive) { card.hover(page: index, $0) })
    .help(page.lines.joined(separator: "\n"))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: name + " " + text))
  }
}
