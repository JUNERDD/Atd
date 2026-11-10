import AICore
import SwiftUI

/// The long screenshot lightbox's bars over its column, on the shell's glass pinned dark
/// (``IslandLightboxBar``), inside the work area: the top bar 16 pt below its top, the bottom
/// bar 20 pt above its bottom. In annotate mode the editor's own bars take the top bar's middle.
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

/// Restore while there is something to restore, and the × back to the card.
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
    let end = restore + IslandMetrics.controlSide + IslandMetrics.lightboxBarTrailing * 2
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

/// The bottom bar: the key hints | the sensitive status (Cover, or what is covered) | Annotate
/// (Done in annotate mode) | Copy | Attach, the primary action; Copy and Attach report how they
/// went on their own buttons, as the card's footer does. The hints give way first on a narrow
/// screen, then the actions compact to their glyphs.
///
/// Both ends hold capsules, so both stand ``IslandMetrics/lightboxBarTrailing`` in: a button's
/// own inset then puts its text as far in as a bar's text, and the first keycap, set in by
/// ``hintsInset`` more, stands concentric with the bar.
private struct IslandLongScreenshotBottomBar: View {
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
    let card = content.card
    let feedback = card.feedback.states
    let annotating = content.annotating
    return IslandLightboxBar(
      height: IslandMetrics.lightboxBottomBarHeight, leading: IslandMetrics.lightboxBarTrailing
    ) {
      if hints {
        IslandLongScreenshotHints(labels: labels, annotating: annotating)
          .padding(.leading, Self.hintsInset)
        IslandLightboxDivider()
      }
      IslandLongScreenshotSensitive(content: content)
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
    .fixedSize()
    .modifier(IslandLongScreenshotBarHover())
  }
}

/// The keys the lightbox reads: ↑↓ scroll, + − zoom, Escape back to the card; in annotate mode
/// only Escape, which finishes annotating.
private struct IslandLongScreenshotHints: View {
  let labels: IslandLongScreenshotLabels
  let annotating: Bool

  var body: some View {
    HStack(spacing: 10) {
      if !annotating {
        hint(["↑↓"], labels.hintScroll)
        hint(["+", "−"], labels.hintZoom)
      }
      hint(["esc"], annotating ? labels.done : labels.back)
    }
  }

  private func hint(_ keys: [String], _ label: String) -> some View {
    HStack(spacing: 4) {
      ForEach(keys, id: \.self) { IslandKeycap(symbol: $0) }
      Text(verbatim: label).font(IslandType.hint).foregroundStyle(.secondary).lineLimit(1)
    }
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: keys.joined(separator: " ") + " " + label))
  }
}

/// The sensitive parts in the kept range: Cover, which pixelates them, until they are covered,
/// then what is covered, in secondary text.
private struct IslandLongScreenshotSensitive: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    let state = content.card.state
    let counts = state.sensitiveCounts
    if !counts.isEmpty {
      if state.kept.covered {
        Text(verbatim: labels.sensitive(counts, covered: true))
          .font(IslandType.hint)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          // A text button's inset, so it stands among the buttons as their labels do.
          .padding(.horizontal, 10)
      } else {
        IslandTextButton(
          title: labels.coverKinds(counts), tooltip: labels.coverTooltip, glyph: "scan-eye"
        ) { content.card.cover() }
      }
    }
  }
}

/// A bar's own hover: passive, so the pointer over a bar's glass, rather than its buttons, marks
/// no page of the image under it.
private struct IslandLongScreenshotBarHover: ViewModifier {
  func body(content: Content) -> some View {
    content.modifier(FloatingHover(pointer: .passive) { _ in })
  }
}
