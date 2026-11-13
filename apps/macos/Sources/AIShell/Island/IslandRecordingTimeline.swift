import AICore
import SwiftUI

/// The recording's timeline (R9), in the result card and, larger, in its lightbox's bottom bar:
/// play or pause, the filmstrip (``IslandRecordingTrack``), the clock and, on the card, the
/// full screen preview's button. The strip is both the scrubber and the trim, as in QuickTime
/// and Photos: frames of the recording across it, yellow handles around the kept range with the
/// rest shaded, a white playhead, and a dot under it for each step. Pressing the strip moves the
/// playhead and scrubs while held; a dragged handle sets its end and shows the frame it is on; a
/// dot previews its step on hover and goes there on a click; hovering the strip elsewhere shows
/// that moment's frame in a bubble above it (``IslandRecordingFrameBubble``). The handle pressed
/// last takes the card's arrow keys (``IslandRecording/key(_:)``), and VoiceOver adjusts either
/// handle. Both surfaces draw the one card model, so a trim or the playhead moved in one shows in
/// the other.
struct IslandRecordingTimeline: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  /// The filmstrip's height: the card's, or the lightbox's taller one.
  var film = IslandMetrics.recordingFilmHeight
  /// The surface's hover frame.
  let bubble: IslandRecordingFrameBubble
  /// Opens the lightbox: the card's full screen preview button. The lightbox has none.
  var fullScreen: (() -> Void)?

  var body: some View {
    let source = card.source
    // The playhead never passes the duration, so the clock keeps the room of the duration's.
    let reserve = RecordingClock.reserved(for: source.duration)
    // Round buttons stand centred on the strip.
    let buttonTop = (film - IslandMetrics.controlSide) / 2
    HStack(alignment: .top, spacing: IslandMetrics.recordingClockGap) {
      IslandRecordingPlayButton(card: card, labels: labels)
        .padding(.top, buttonTop)
      IslandRecordingTrack(card: card, labels: labels, film: film, bubble: bubble)
        .frame(height: film + IslandMetrics.recordingMarksBand)
      IslandRecordingClock(card: card, reserve: reserve)
        .frame(height: film)
      if let fullScreen {
        IslandIconButton(
          glyph: IslandIcons.fullScreen, label: labels.fullScreen,
          tooltip: labels.fullScreenTooltip, action: fullScreen
        )
        .padding(.top, buttonTop)
        .padding(.leading, -4)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.timeline))
  }
}

/// Play/pause toggle isolated so `card.playing` changes do not rebuild the track or filmstrip.
private struct IslandRecordingPlayButton: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels

  var body: some View {
    IslandIconButton(
      glyph: card.playing ? IslandIcons.pause : IslandIcons.play,
      label: card.playing ? labels.pause : labels.play
    ) { card.togglePlay() }
  }
}

/// Live playhead/duration readout isolated so 60fps playback updates only this leaf view.
private struct IslandRecordingClock: View {
  let card: IslandRecordingCardModel
  let reserve: String

  var body: some View {
    IslandStableText(
      text: RecordingClock.text(card.playhead) + " / " + RecordingClock.text(card.source.duration),
      reserve: [reserve + " / " + reserve]
    )
    .font(IslandType.hint)
    .monospacedDigit()
    .foregroundStyle(.secondary)
  }
}

/// The frames across the strip, `cells` of them, each the made frame nearest the middle of an
/// equal share of the recording (``IslandRecordingCardModel/frame(at:)``), cut to fill its
/// share; black until made.
struct IslandRecordingFilm: View {
  let card: IslandRecordingCardModel
  let cells: Int

  var body: some View {
    let duration = card.source.duration
    HStack(spacing: 0) {
      ForEach(0..<max(cells, 1), id: \.self) { cell in
        ZStack {
          let middle = (Double(cell) + 0.5) / Double(max(cells, 1)) * duration
          if let frame = card.frame(at: middle)?.image {
            Image(decorative: frame, scale: 1).resizable().scaledToFill()
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
      }
    }
    .background(Color.black)
    .accessibilityHidden(true)
  }
}

/// A step's dot under the strip: the accent at the playhead's step, dimmed outside the kept
/// range, larger while it or its row has the pointer. Its hit area is larger than the dot.
struct IslandRecordingMark: View, Equatable {
  let card: IslandRecordingCardModel
  let index: Int
  let isKept: Bool
  let isCurrent: Bool
  let isHovered: Bool

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.card === rhs.card && lhs.index == rhs.index && lhs.isKept == rhs.isKept
      && lhs.isCurrent == rhs.isCurrent && lhs.isHovered == rhs.isHovered
  }

  var body: some View {
    let step = card.source.steps[index]
    Circle()
      .fill(
        isCurrent
          ? AnyShapeStyle(Color.accentColor)
          : isKept ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary)
      )
      .frame(width: 6, height: 6)
      .scaleEffect(isHovered ? 1.5 : 1)
      .animation(.easeOut(duration: 0.12), value: isHovered)
      .frame(width: 18, height: 18)
      .contentShape(Rectangle())
      .onTapGesture { card.seek(step.time) }
      .help(RecordingClock.text(step.time) + " " + step.text)
      .accessibilityLabel(Text(verbatim: RecordingClock.text(step.time) + " " + step.text))
      .accessibilityAddTraits(.isButton)
  }
}

/// The kept range's outline: yellow sides as wide as the handles and thinner top and bottom
/// edges, the frames showing through the middle (filled even-odd).
struct IslandTrimRange: Shape {
  func path(in rect: CGRect) -> Path {
    let outer = IslandMetrics.recordingFilmRadius
    let side = IslandMetrics.recordingHandleWidth
    let edge = IslandMetrics.recordingRangeEdge
    var path = Path(roundedRect: rect, cornerRadius: outer, style: .continuous)
    let inner = rect.insetBy(dx: min(side, rect.width / 2), dy: edge)
    // The 10 pt side exceeds the outer radius, leaving square corners in the opening.
    if inner.width > 0 { path.addRect(inner) }
    return path
  }
}
