import AICore
import SwiftUI

/// The timeline's hover frame as a surface draws it (``IslandRecordingFrameBubble``): the frame
/// at the moment under the pointer in an 8 pt corner, its time under it, on a dark rounded plate
/// with a soft shadow, centred over the pointer above the strip and kept inside `bounds` (the
/// card, or the lightbox's screen). The surface lays it over everything at its root, in the
/// bubble's coordinate space. It is opaque rather than glass, since it stands on the card's
/// glass, and always dark, as media is; it takes no clicks and VoiceOver skips it, since the
/// strip's handles and the clock say where the playhead is.
struct IslandRecordingFrameBubbleView: View {
  let bubble: IslandRecordingFrameBubble
  let card: IslandRecordingCardModel
  /// The size of what the bubble stays inside, in the bubble's space.
  let bounds: CGSize

  var body: some View {
    if let time = bubble.time {
      let frame = bubble.size.frame(aspect: card.source.aspect)
      let whole = IslandMetrics.recordingBubble(frame: frame)
      let origin = IslandMetrics.recordingBubbleOrigin(
        x: bubble.anchor.x, stripTop: bubble.anchor.y, size: whole,
        bounds: WindowSize(width: bounds.width, height: bounds.height))
      plate(time: time, frame: frame)
        .frame(width: whole.width, height: whole.height)
        .offset(x: origin.x, y: origin.y)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }

  private func plate(time: Double, frame: WindowSize) -> some View {
    let padding = IslandMetrics.recordingBubblePadding
    let corner = IslandMetrics.recordingBubbleRadius
    return VStack(spacing: 0) {
      ZStack {
        Color.black
        if let image = image(at: time) {
          Image(decorative: image, scale: 1).resizable().scaledToFit()
        }
      }
      .frame(width: frame.width, height: frame.height)
      .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
      Text(verbatim: RecordingClock.text(time))
        .font(IslandType.hint)
        .monospacedDigit()
        .foregroundStyle(Color.white.opacity(0.75))
        .lineLimit(1)
        .frame(height: IslandMetrics.recordingBubbleLabel)
    }
    .padding([.horizontal, .top], padding)
    .background {
      let plate = RoundedRectangle(cornerRadius: corner + padding, style: .continuous)
      plate
        .fill(Color(white: 0.1))
        .overlay { plate.strokeBorder(Color.white.opacity(0.12), lineWidth: 1) }
        .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
    }
  }

  /// The nearer of the latest precise frame and the filmstrip's frame for `time`.
  private func image(at time: Double) -> CGImage? {
    let standIn = card.frame(at: time)
    guard let precise = bubble.precise else { return standIn?.image }
    guard let standIn, abs(standIn.time - time) < abs(precise.time - time) else {
      return precise.image
    }
    return standIn.image
  }
}
