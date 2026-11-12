import AICore
import SwiftUI

/// The long screenshot lightbox's side panel (``IslandLightboxPanel``) with the text commands'
/// latest result card: the command's name with the versions' pager and Regenerate in its header,
/// the note and the body (``CaptureResultBody``) of the page shown scrolling, a streaming page's
/// newest content kept in view and each page started at its top (``CaptureResultPageTop``), and
/// pinned at the bottom the versions' adjust field and chips, a summary of what other runs left on
/// the image with its Restore, and the card's footer, whose actions report on their own buttons.
/// Escape here only stops, so the footer shows its hint only while the run produces, beside ⌥'s,
/// and a result waiting for review is discarded by the footer's Discard before Apply.
///
/// Hovering an item lights its place on the image and a click scrolls the image to its paragraph
/// and flashes it; the items whose paragraph the viewer shows rest on a fainter wash.
struct LongScreenshotResultsPanel: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let results = content.results
    let model = results.model
    if let card = model.card {
      IslandLightboxPanel(
        title: card.title, hide: content.labels.hidePanel,
        reduceMotion: content.lightbox.reduceMotion, follows: model.follows(card),
        onHide: { content.panel.hide() },
        tools: {
          if let versions = card.versions {
            CaptureResultReviewPager(model: model, review: versions)
          }
        },
        content: { proxy in
          VStack(alignment: .leading, spacing: 0) {
            CaptureResultNote(text: model.labels.note(card), busy: card.busy)
            if model.shownBody(card) != .none {
              CaptureResultBody(model: model, card: card)
                .padding(.vertical, IslandMetrics.sectionGap)
            }
          }
          .modifier(
            CaptureResultPageTop(page: model.page(card), follows: model.follows(card), proxy: proxy)
          )
        },
        footer: {
          VStack(alignment: .leading, spacing: 0) {
            if let versions = card.versions {
              CaptureResultReviewControls(model: model, review: versions)
            }
            if results.othersChanged, !model.dock.isEmpty {
              LongScreenshotResultsSummary(model: model)
            }
            CaptureResultFooter(
              model: model, card: card, hints: card.hints.filter { $0 == .stop || $0 == .original },
              feedback: results.feedback.states, offersDiscard: true)
          }
        })
    }
  }
}

/// What the text commands left on the image while runs other than the one the panel shows changed
/// it: Restore takes every AI change off as one undo step.
private struct LongScreenshotResultsSummary: View {
  let model: CaptureResultCardModel

  var body: some View {
    let labels = model.labels
    let summary = labels.dock(model.dock)
    HStack(spacing: 6) {
      IslandGlyph(name: "sparkles", side: 14).foregroundStyle(.tint)
      Text(verbatim: summary)
        .font(IslandType.hint)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(1)
        .truncationMode(.tail)
        .help(summary)
      Spacer(minLength: 8)
      IslandTextButton(title: labels.revert, tooltip: labels.dockRevertTooltip) {
        model.onAction(.revertAll)
      }
    }
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.controlSide)
    .padding(.top, IslandMetrics.sectionGap)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: summary))
  }
}
