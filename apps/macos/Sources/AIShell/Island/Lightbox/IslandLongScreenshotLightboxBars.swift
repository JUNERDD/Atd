import AICore
import SwiftUI

/// The long screenshot lightbox's bars over its column, on the shell's glass pinned dark
/// (``IslandLightboxBar``), inside the work area: the top bar 16 pt below its top, the bottom
/// bar 20 pt above its bottom, and the text command row docked
/// ``LongScreenshotLightboxLayout/textRowGap`` above it while it shows
/// (``IslandLongScreenshotLightbox/showsTextRow``). In annotate mode the editor's own bars take
/// the top bar's middle.
struct IslandLongScreenshotLightboxChrome: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let layout = content.viewport.layout
    VStack(spacing: 0) {
      if content.annotating {
        IslandLongScreenshotAnnotateTop(content: content)
      } else {
        IslandLongScreenshotTopBar(content: content)
      }
      Spacer(minLength: 0)
      if content.showsTextRow {
        IslandLongScreenshotTextRow(content: content)
          .padding(.bottom, LongScreenshotLightboxLayout.textRowGap)
      }
      IslandLongScreenshotBottomBar(content: content)
    }
    .padding(.top, layout.workArea.minY - layout.column.minY + IslandMetrics.lightboxTopInset)
    .padding(.bottom, layout.column.maxY - layout.workArea.maxY + IslandMetrics.lightboxBottomInset)
    .padding(.horizontal, 16)
  }
}

/// The title and the card's subtitle, the subtitle cut with an ellipsis (its tooltip has it).
private struct IslandLongScreenshotLightboxTitle: View {
  let content: IslandLongScreenshotLightbox
  var subtitle = true

  var body: some View {
    let labels = content.labels
    let text = labels.subtitle(content.card.state)
    Text(verbatim: labels.title)
      .font(.system(size: 13, weight: .semibold))
      .lineLimit(1)
      .fixedSize()
      .accessibilityAddTraits(.isHeader)
    if subtitle {
      Text(verbatim: text)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(1)
        .truncationMode(.tail)
        .help(text)
        .padding(.leading, 8)
        .padding(.trailing, 4)
    }
  }
}

/// Restore while there is something to restore, the side panel's toggle once a text command ran,
/// and the × back to the card.
private struct IslandLongScreenshotLightboxEnd: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    if content.card.state.canRestore {
      IslandTextButton(
        title: labels.restore, tooltip: labels.restoreTooltip,
        foreground: Color(nsColor: .linkColor)
      ) { content.card.restore() }
    }
    if content.hasResult {
      IslandLightboxPanelToggle(
        title: labels.results, tooltip: labels.resultsTooltip, shown: content.panel.shown,
        dot: content.panelDot
      ) { content.togglePanel() }
    }
    IslandIconButton(
      glyph: AnnotationIcons.cancel, label: labels.back, tooltip: labels.backTooltip
    ) { content.lightbox.close() }
  }
}

/// View mode's top bar: the title | the pages | the zoom | Restore and back to the card.
private struct IslandLongScreenshotTopBar: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    let viewer = content.viewer
    IslandLightboxBar {
      IslandLongScreenshotLightboxTitle(content: content)
      IslandLightboxDivider()
      IslandLongScreenshotPages(content: content)
      IslandLightboxDivider()
      IslandIconButton(glyph: "minus", label: labels.zoomOut) { viewer.zoomOut() }
      IslandLongScreenshotZoomLabel(content: content)
      IslandIconButton(glyph: IslandIcons.attach, label: labels.zoomIn) { viewer.zoomIn() }
      IslandLightboxDivider()
      IslandLongScreenshotLightboxEnd(content: content)
    }
    .modifier(IslandLongScreenshotBarHover())
  }
}

/// The page counter between the previous and next page buttons, each disabled at its end.
private struct IslandLongScreenshotPages: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    let count = content.card.pages.count
    let current = content.viewer.currentPage ?? 0
    IslandIconButton(glyph: "chevron-up", label: labels.previousPage) {
      content.viewer.showPage(-1)
    }
    .disabled(current <= 0)
    Text(verbatim: labels.page(current + 1, of: max(count, 1)))
      .font(.system(size: 12))
      .monospacedDigit()
      .lineLimit(1)
      .frame(minWidth: 76)
    IslandIconButton(glyph: "chevron-down", label: labels.nextPage) {
      content.viewer.showPage(1)
    }
    .disabled(current >= count - 1)
  }
}

/// The zoom's percentage, which switches between fitting the width and the actual size.
private struct IslandLongScreenshotZoomLabel: View {
  let content: IslandLongScreenshotLightbox
  @State private var hovered = false

  var body: some View {
    let labels = content.labels
    let percent = "\(Int((content.viewport.zoom * 100).rounded()))%"
    Button {
      content.viewer.toggleFit()
    } label: {
      Text(verbatim: percent)
        .font(.system(size: 12, weight: .medium))
        .monospacedDigit()
        .frame(minWidth: 52, minHeight: IslandMetrics.controlSide)
    }
    .buttonStyle(IslandWashStyle(shape: Capsule(), hovered: hovered))
    .modifier(FloatingHover { hovered = $0 })
    .help(labels.zoomTooltip)
    .accessibilityValue(
      Text(verbatim: content.viewport.fitted ? percent + ", " + labels.fit : percent)
    )
    .accessibilityHint(Text(verbatim: labels.zoomTooltip))
  }
}

/// Annotate mode's top: the editor's tool bar (and its style bar while something is styled)
/// in the middle, its own glass, between the title and the way back to the card, which give way
/// on a narrow screen, the title first. The editor's bars are AppKit views that live in one place
/// at a time, so the row is chosen by width here rather than by trying each one
/// (`ViewThatFits` would host the bars in every candidate it measures).
private struct IslandLongScreenshotAnnotateTop: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    let room = content.viewport.layout.column.width - 32
    let bars = content.annotator.barsWidth
    let title =
      IslandType.width(of: labels.title, weight: .semibold, limit: room)
      + IslandMetrics.lightboxBarLeading * 2
    let restore =
      content.card.state.canRestore ? IslandType.width(of: labels.restore, limit: room) + 22 : 0
    let toggle = content.hasResult ? IslandLightboxPanelToggle.width(of: labels.results) + 2 : 0
    let end = restore + toggle + IslandMetrics.controlSide + IslandMetrics.lightboxBarTrailing * 2
    let showsEnd = bars + 8 + end <= room
    row(title: showsEnd && bars + title + end + 16 <= room, end: showsEnd)
  }

  private func row(title: Bool, end: Bool) -> some View {
    HStack(spacing: 8) {
      if title {
        // Text alone, so as far from both ends.
        IslandLightboxBar(trailing: IslandMetrics.lightboxBarLeading) {
          IslandLongScreenshotLightboxTitle(content: content, subtitle: false)
        }
        .fixedSize()
        .modifier(IslandLongScreenshotBarHover())
      }
      content.annotator.bars
      if end {
        IslandLightboxBar(leading: IslandMetrics.lightboxBarTrailing) {
          IslandLongScreenshotLightboxEnd(content: content)
        }
        .fixedSize()
        .modifier(IslandLongScreenshotBarHover())
      }
    }
  }
}

/// A bar's own hover: passive, so the pointer over a bar's glass, rather than its buttons, marks
/// no page of the image under it.
struct IslandLongScreenshotBarHover: ViewModifier {
  func body(content: Content) -> some View {
    content.modifier(FloatingHover(pointer: .passive) { _ in })
  }
}
