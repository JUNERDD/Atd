import AICore
import AppKit
import SwiftUI

/// What the recording's lightbox shows over the scrim, in the window's whole size (top-left
/// origin), laid out by ``IslandMetrics/recordingLightboxLayout(window:area:recorded:aspect:steps:)``:
/// the player on the stage, never larger than the recording's own size; the steps panel on the
/// right, glass, while it is toggled on and the window is wide enough; the top bar over the media
/// column ("Screen Recording", the card's subtitle, Restore while trimmed, the steps toggle and
/// Back to Card); and the two-row bottom bar: the timeline with the larger filmstrip, then the
/// keys' hints and the card's actions (``IslandRecordingActions``).
///
/// The player grows from the card's (``IslandLightboxModel/mediaFrame(_:)``) and goes back to
/// it; the chrome fades in once it has landed and goes first. A click on the player plays or
/// pauses and a double-click goes back to the card; a click on the scrim around it closes too.
struct IslandRecordingLightboxView: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let lightbox: IslandLightboxModel
  let state: IslandRecordingLightboxState

  var body: some View {
    let size = lightbox.size
    let window = WindowSize(width: size.width, height: size.height)
    let layout = IslandMetrics.recordingLightboxLayout(
      window: window, area: lightbox.workArea, recorded: card.source.pointSize,
      aspect: card.source.aspect, steps: state.stepsShown)
    let player = lightbox.mediaFrame(layout.player)
    ZStack(alignment: .topLeading) {
      IslandRecordingPlayer(
        card: card, labels: labels,
        size: WindowSize(width: player.width, height: player.height),
        hint: labels.lightboxPlayerHint
      ) { lightbox.close() }
      .position(x: player.midX, y: player.midY)
      .opacity(lightbox.mediaOpacity)
      chrome(layout, window: window)
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
    _ layout: IslandMetrics.RecordingLightboxLayout, window: WindowSize
  ) -> some View {
    let area = lightbox.workArea
    let column = layout.column
    if let steps = layout.steps {
      let outline = RoundedRectangle(
        cornerRadius: IslandMetrics.recordingLightboxStepsRadius, style: .continuous)
      IslandRecordingSteps(card: card, labels: labels, reduceMotion: lightbox.reduceMotion)
        .padding(6)
        .frame(width: steps.width, height: steps.height, alignment: .topLeading)
        .glassSurface(in: outline, animation: nil, dark: true)
        // A click on the panel between its rows is not one on the scrim.
        .contentShape(outline)
        .position(x: steps.midX, y: steps.midY)
        .transition(.opacity)
    }
    // The bar hugs its content up to the column's width, cutting the subtitle past it.
    IslandRecordingLightboxTopBar(
      card: card, labels: labels, state: state, lightbox: lightbox,
      stepsAvailable: window.width >= IslandMetrics.recordingLightboxStepsMinWindow
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
  }
}

/// The lightbox's top bar: "Screen Recording" and the card's subtitle (cut with an ellipsis,
/// whole in its tooltip), Restore while the recording is trimmed, the steps panel's toggle where
/// the window has room for the panel, and Back to Card.
private struct IslandRecordingLightboxTopBar: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let state: IslandRecordingLightboxState
  let lightbox: IslandLightboxModel
  let stepsAvailable: Bool

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
      if stepsAvailable {
        IslandTextButton(
          title: labels.lightboxSteps, tooltip: labels.lightboxStepsTooltip,
          rest: state.stepsShown ? 0.1 : 0, glyph: IslandIcons.steps
        ) {
          withAnimation(
            lightbox.reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 1)
          ) { state.stepsShown.toggle() }
        }
        .accessibilityAddTraits(state.stepsShown ? .isSelected : [])
      }
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
