import AICore
import AppKit
import SwiftUI

/// What the recording's lightbox shows over the scrim, in the window's whole size (top-left
/// origin), laid out by ``IslandMetrics/recordingLightboxLayout(area:recorded:aspect:dockedPanel:)``:
/// the player on the stage, never larger than the recording's own size; the side panel with the
/// steps on the right (``IslandRecordingStepsPanel``) while it shows, docked beside the stage or
/// a drawer over its right side between the bars; the top bar over the media column ("Screen
/// Recording", the card's subtitle, Restore while trimmed, the steps' toggle and Back to Card);
/// and the two-row bottom bar: the timeline with the larger filmstrip, then the keys' hints and
/// the card's actions (``IslandRecordingActions``).
///
/// The player grows from the card's (``IslandLightboxModel/mediaFrame(_:)``) and goes back to
/// it; the chrome fades in once it has landed and goes first. A click on the player plays or
/// pauses and a double-click goes back to the card; a click on the scrim around it closes too.
/// Under a drawer, a click on either closes the drawer instead (``IslandLightboxDrawerCatcher``).
struct IslandRecordingLightboxView: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let lightbox: IslandLightboxModel
  let state: IslandRecordingLightboxState

  var body: some View {
    let size = lightbox.size
    let placement = state.placement(in: lightbox.workArea)
    let layout = IslandMetrics.recordingLightboxLayout(
      area: lightbox.workArea, recorded: card.source.pointSize, aspect: card.source.aspect,
      dockedPanel: placement.docked)
    let player = lightbox.mediaFrame(layout.player)
    ZStack(alignment: .topLeading) {
      IslandRecordingPlayer(
        card: card, labels: labels,
        size: WindowSize(width: player.width, height: player.height),
        hint: labels.lightboxPlayerHint
      ) { lightbox.close() }
      .position(x: player.midX, y: player.midY)
      .opacity(lightbox.mediaOpacity)
      chrome(layout, placement: placement)
        .opacity(lightbox.chromeOpacity)
        .allowsHitTesting(lightbox.chromeShown)
    }
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .coordinateSpace(.named(IslandRecordingFrameBubble.space))
    .overlay(alignment: .topLeading) {
      IslandRecordingFrameBubbleView(bubble: state.bubble, card: card, bounds: size)
    }
    // Space plays or pauses only while no button has the keyboard focus.
    .onPreferenceChange(IslandControlFocus.self) { state.controlFocused = $0 }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.lightbox))
    .accessibilityAddTraits(.isModal)
  }

  @ViewBuilder
  private func chrome(
    _ layout: IslandMetrics.RecordingLightboxLayout,
    placement: IslandMetrics.LightboxPanelPlacement
  ) -> some View {
    let area = lightbox.workArea
    let column = layout.column
    if placement.isDrawer { IslandLightboxDrawerCatcher { state.panel.hide() } }
    // The bar hugs its content up to the column's width, cutting the subtitle past it.
    IslandRecordingLightboxTopBar(
      card: card, labels: labels, panel: state.panel, lightbox: lightbox
    )
    .frame(width: column.width)
    .position(
      x: column.midX,
      y: area.minY + IslandMetrics.lightboxTopInset + IslandMetrics.lightboxTopBarHeight / 2)
    IslandRecordingLightboxBottomBar(
      card: card, labels: labels, bubble: state.bubble, width: layout.barWidth
    )
    .position(
      x: column.midX,
      y: area.maxY - IslandMetrics.lightboxBottomInset
        - IslandMetrics.recordingLightboxBarHeight / 2)
    IslandLightboxPanelSlot(placement: placement) {
      IslandRecordingStepsPanel(
        card: card, labels: labels, reduceMotion: lightbox.reduceMotion
      ) { state.panel.hide() }
    }
  }
}

/// The lightbox's top bar: "Screen Recording" and the card's subtitle (cut with an ellipsis,
/// whole in its tooltip), Restore while the recording is trimmed, the steps' toggle, and Back to
/// Card.
private struct IslandRecordingLightboxTopBar: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let panel: IslandLightboxPanelState
  let lightbox: IslandLightboxModel

  var body: some View {
    let subtitle = card.subtitle(labels)
    IslandLightboxBar {
      Text(verbatim: labels.title)
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
        .fixedSize()
        .padding(.trailing, 6)
        .accessibilityAddTraits(.isHeader)
      Text(verbatim: subtitle)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(1)
        .truncationMode(.tail)
        .help(subtitle)
        .padding(.trailing, 6)
      if card.state.isTrimmed {
        IslandTextButton(
          title: labels.restore, tooltip: labels.restoreTooltip,
          foreground: Color(nsColor: .linkColor)
        ) { card.resetTrim() }
      }
      IslandLightboxDivider()
      IslandLightboxPanelToggle(
        title: labels.lightboxSteps, tooltip: labels.lightboxStepsTooltip, shown: panel.shown
      ) { panel.toggle() }
      IslandIconButton(
        glyph: AnnotationIcons.cancel, label: labels.lightboxBack,
        tooltip: labels.lightboxBackTooltip
      ) { lightbox.close() }
    }
    // A click on the bar between its controls is not one on the scrim.
    .contentShape(Capsule())
  }
}

/// The lightbox's bottom bar, `width` wide: the timeline with the larger filmstrip and the hover
/// frame, then the keys' hints and the card's actions. Where the row cannot fit whole, Save and
/// Copy turn into glyphs first, then the hints go.
private struct IslandRecordingLightboxBottomBar: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let bubble: IslandRecordingFrameBubble
  let width: Double

  var body: some View {
    let padding = IslandMetrics.recordingLightboxBarPadding
    let trailing = padding + 2
    let outline = RoundedRectangle(
      cornerRadius: IslandMetrics.recordingLightboxBarRadius, style: .continuous)
    IslandLightboxBar(
      height: nil, outline: AnyShape(outline), leading: padding, trailing: trailing
    ) {
      VStack(alignment: .leading, spacing: IslandMetrics.recordingLightboxBarRowGap) {
        IslandRecordingTimeline(
          card: card, labels: labels, film: IslandMetrics.recordingLightboxFilmHeight,
          bubble: bubble)
        ViewThatFits(in: .horizontal) {
          row(hints: true, compact: false)
          row(hints: true, compact: true)
          row(hints: false, compact: true)
        }
      }
      .padding(.vertical, padding)
      .frame(width: max(width - padding - trailing, 1), alignment: .leading)
    }
    // A click on the bar between its controls is not one on the scrim.
    .contentShape(outline)
  }

  private func row(hints: Bool, compact: Bool) -> some View {
    HStack(spacing: 6) {
      if hints {
        HStack(spacing: 14) {
          IslandKeysHint(keys: ["␣"], label: labels.lightboxHintPlay)
          IslandKeysHint(keys: ["←", "→"], label: labels.lightboxHintSeek)
          IslandKeysHint(keys: ["I", "O"], label: labels.lightboxHintTrim)
          IslandKeysHint(keys: ["esc"], label: labels.lightboxHintBack)
        }
      }
      Spacer(minLength: 16)
      HStack(spacing: IslandMetrics.gap) {
        IslandRecordingActions(card: card, labels: labels, compact: compact)
      }
      .fixedSize()
    }
    .padding(.leading, 8)
    .frame(height: IslandMetrics.controlSide)
  }
}

/// Keys and what they do, for the lightbox's hints: each key a keycap (``IslandKeycap``), then
/// the words.
private struct IslandKeysHint: View {
  let keys: [String]
  let label: String

  var body: some View {
    HStack(spacing: 4) {
      ForEach(keys, id: \.self) { IslandKeycap(symbol: $0) }
      Text(verbatim: label).font(IslandType.hint).foregroundStyle(.secondary).lineLimit(1)
    }
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: keys.joined(separator: " ") + " " + label))
  }
}
