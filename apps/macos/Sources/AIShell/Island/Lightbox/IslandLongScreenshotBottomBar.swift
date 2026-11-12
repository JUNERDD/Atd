import AICore
import SwiftUI

/// The lightbox's bottom bar. In view and annotate mode: the key hints | Select Text | Cover
/// Sensitive Info while anything sensitive has no mosaic over it | Annotate (Done in annotate
/// mode) | Copy | Attach, the primary action; Copy and Attach report how they went on their own
/// buttons, as the card's footer does. In text mode: its key hints (a drag selects, Space held
/// pans, Escape leaves) | Done. Select Text and Cover Sensitive Info lead with their glyphs, as
/// the capture toolbar's do; the other actions show their labels. The hints give way first on a
/// narrow screen, then the actions compact to their glyphs.
///
/// Both ends hold capsules, so both stand ``IslandMetrics/lightboxBarTrailing`` in: a button's
/// own inset then puts its text as far in as a bar's text, and the first keycap, set in by
/// ``hintsInset`` more, stands concentric with the bar.
struct IslandLongScreenshotBottomBar: View {
  let content: IslandLongScreenshotLightbox

  private static let hintsInset =
    (IslandMetrics.lightboxBottomBarHeight - GlassHUDPieces.keycapHeight) / 2
    - IslandMetrics.lightboxBarTrailing

  var body: some View {
    ViewThatFits(in: .horizontal) {
      bar(hints: true, compact: false)
      bar(hints: false, compact: false)
      bar(hints: false, compact: true)
    }
  }

  private func bar(hints: Bool, compact: Bool) -> some View {
    let labels = content.labels
    let mode = content.mode
    return IslandLightboxBar(
      height: IslandMetrics.lightboxBottomBarHeight, leading: IslandMetrics.lightboxBarTrailing
    ) {
      if hints {
        IslandLongScreenshotHints(labels: labels, mode: mode)
          .padding(.leading, Self.hintsInset)
        IslandLightboxDivider()
      }
      if mode == .text {
        IslandFeedbackButton(
          title: labels.done, glyph: "check", workingLabel: labels.actionWorking,
          tooltip: labels.textDoneTooltip, compact: compact, feedback: nil
        ) { content.toggleTextMode() }
      } else {
        actions(compact: compact)
      }
    }
    .fixedSize()
    .modifier(IslandLongScreenshotBarHover())
  }

  @ViewBuilder private func actions(compact: Bool) -> some View {
    let labels = content.labels
    let feedback = content.card.feedback.states
    let annotating = content.annotating
    IslandFeedbackButton(
      title: labels.select, glyph: "square-dashed-text", workingLabel: labels.actionWorking,
      tooltip: labels.selectTooltip, compact: compact, glyphAtRest: true, feedback: nil
    ) { content.toggleTextMode() }
    IslandLongScreenshotRedact(content: content, compact: compact)
    IslandFeedbackButton(
      title: annotating ? labels.done : labels.annotate, glyph: annotating ? "check" : "pencil",
      workingLabel: labels.actionWorking,
      tooltip: annotating ? labels.doneTooltip : labels.annotateTooltip, compact: compact,
      feedback: nil
    ) { content.setAnnotating(!annotating) }
    IslandFeedbackButton(
      title: labels.copy, glyph: IslandIcons.copy, workingLabel: labels.actionWorking,
      tooltip: labels.copyTooltip, keys: IslandShellFooterKey.copyKeys, compact: compact,
      feedback: feedback[.copy]
    ) { content.send(.copy) }
    IslandFeedbackButton(
      title: labels.attach, glyph: IslandIcons.attach, workingLabel: labels.actionWorking,
      tooltip: labels.attachTooltip, keys: IslandShellFooterKey.attachKeys, primary: true,
      compact: compact, feedback: feedback[.attach]
    ) { content.send(.attach) }
  }
}

/// The keys the lightbox reads: ↑↓ scroll, + − zoom, Escape back to the card; in annotate mode
/// only Escape, which finishes annotating; in text mode a drag selects, Space held pans and
/// Escape leaves text mode.
private struct IslandLongScreenshotHints: View {
  let labels: IslandLongScreenshotLabels
  let mode: LongScreenshotLightboxMode

  var body: some View {
    HStack(spacing: 10) {
      switch mode {
      case .view:
        hint(["↑↓"], labels.hintScroll)
        hint(["+", "−"], labels.hintZoom)
        hint(["esc"], labels.back)
      case .text:
        hint([], labels.hintMarquee)
        hint(["␣"], labels.hintPan)
        hint(["esc"], labels.hintExit)
      case .annotate:
        hint(["esc"], labels.done)
      }
    }
  }

  private func hint(_ keys: [String], _ label: String) -> some View {
    HStack(spacing: 4) {
      ForEach(keys, id: \.self) { IslandKeycap(symbol: $0) }
      Text(verbatim: label).font(IslandType.hint).foregroundStyle(.secondary).lineLimit(1)
    }
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: (keys + [label]).joined(separator: " ")))
  }
}

/// Cover Sensitive Info (decision D7), a shortcut to the mosaic tool's auto-redact: it shows
/// while a sensitive item in the kept range has no mosaic over it, its tooltip listing their
/// kinds, then says how many it covered for a moment in place of its label; compacted, its
/// glyph alone.
private struct IslandLongScreenshotRedact: View {
  let content: IslandLongScreenshotLightbox
  let compact: Bool

  var body: some View {
    let labels = content.labels
    if content.offersRedaction {
      let confirmed = content.card.redacted.map(IslandLongScreenshotLabels.covered)
      let tooltip =
        confirmed ?? labels.coverTooltip(content.card.state.unmaskedSensitiveCounts)
      if compact {
        IslandIconButton(
          glyph: confirmed == nil ? "scan-eye" : "check", label: confirmed ?? labels.cover,
          tooltip: tooltip
        ) { content.redactSensitive() }
      } else {
        IslandTextButton(
          title: confirmed ?? labels.cover, tooltip: tooltip,
          glyph: confirmed == nil ? "scan-eye" : "check"
        ) { content.redactSensitive() }
      }
    }
  }
}
