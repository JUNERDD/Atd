import AICore
import SwiftUI

/// The timeline's strip itself (``IslandRecordingTimeline``), `film` points tall with the band
/// of step marks under it: frames, shades, the kept range with its handles, the playhead and the
/// step dots, laid out against its own width. Hovering the strip shows the frame under the
/// pointer in the surface's bubble (``IslandRecordingFrameBubble``), which hides while the strip
/// is scrubbed or a handle dragged, since the player shows that frame then; a step's dot keeps
/// its own preview in the player instead.
struct IslandRecordingTrack: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let film: Double
  let bubble: IslandRecordingFrameBubble
  @Environment(\.displayScale) private var scale
  @State private var hoveredMark: Int?
  /// The strip's frame in the bubble's space, where the pointer over it is reported.
  @State private var strip = CGRect.zero
  /// A scrub or a handle's drag is under way: the bubble stays hidden.
  @State private var dragging = false

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let trim = card.state.trim
      ZStack(alignment: .topLeading) {
        // The frames and the shades outside the kept range, in the strip's corner.
        ZStack(alignment: .topLeading) {
          IslandRecordingFilm(
            card: card,
            cells: IslandMetrics.recordingFilmSlots(
              width: width, aspect: card.source.aspect, film: film))
          shade(from: 0, to: x(trim.start, width))
          shade(from: x(trim.end, width), to: width)
        }
        .frame(width: width, height: film, alignment: .topLeading)
        .clipShape(
          RoundedRectangle(cornerRadius: IslandMetrics.recordingFilmRadius, style: .continuous)
        )
        .contentShape(Rectangle())
        .modifier(
          FloatingHover(
            pointer: .passive,
            moved: { point in hoverStrip(at: point.x, width: width) }
          ) { inside in
            if !inside { bubble.hide() }
          }
        )
        .onGeometryChange(for: CGRect.self) {
          $0.frame(in: .named(IslandRecordingFrameBubble.space))
        } action: {
          strip = $0
        }
        .gesture(scrub(width: width))
        IslandTrimRange()
          .fill(Color(nsColor: .systemYellow), style: FillStyle(eoFill: true))
          .frame(width: max(x(trim.end, width) - x(trim.start, width), 1), height: film)
          .offset(x: x(trim.start, width))
          .allowsHitTesting(false)
        handle(.start, at: x(trim.start, width), width: width)
        handle(.end, at: x(trim.end, width), width: width)
        Capsule()
          .fill(.white)
          .background { Capsule().stroke(Color.black.opacity(0.35), lineWidth: 1) }
          .shadow(color: .black.opacity(0.4), radius: 1.5, y: 1)
          .frame(width: 2, height: film + 6)
          .offset(x: x(card.playhead, width) - 1, y: -3)
          .allowsHitTesting(false)
        ForEach(card.source.steps.indices, id: \.self) { index in
          IslandRecordingMark(card: card, index: index)
            // Centred 8 pt under the strip, in its larger hit area.
            .offset(x: x(card.source.steps[index].time, width) - 9, y: film - 1)
        }
        // One region follows all the marks, even for a long recording with thousands of steps,
        // showing the pointing hand over a mark and the arrow between them. It is transparent to
        // clicks: each mark retains its own native gesture and tooltip.
        Color.clear
          .frame(width: width + 18, height: 18)
          .modifier(
            FloatingHover(
              pointer: hoveredMark == nil ? .passive : .action,
              moved: { point in
                hoverMark(at: point.x - 9, width: width)
              }
            ) { inside in
              if !inside { setHoveredMark(nil) }
            }
          )
          .offset(x: -9, y: film - 1)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      .coordinateSpace(.named(Self.space))
      .onChange(of: width.rounded(), initial: true) { _, width in
        card.fillFrames(width: width, height: film, scale: scale)
      }
    }
  }

  private static let space = "recording.track"

  private func x(_ time: Double, _ width: Double) -> Double {
    min(max(time / card.source.duration, 0), 1) * width
  }

  private func time(_ x: Double, _ width: Double) -> Double {
    min(max(x / max(width, 1), 0), 1) * card.source.duration
  }

  /// The pointer is over the strip `pointer` points from its leading edge: the bubble shows that
  /// moment, unless a drag on the strip is under way.
  private func hoverStrip(at pointer: Double, width: Double) {
    guard !dragging else { return }
    bubble.show(
      time(pointer, width), x: strip.minX + min(max(pointer, 0), width), stripTop: strip.minY,
      card: card, scale: scale)
  }

  /// A scrub or a handle's drag begins (true) or ends: the bubble hides for its length.
  private func setDragging(_ next: Bool) {
    guard next != dragging else { return }
    dragging = next
    if next { bubble.hide() }
  }

  /// Marks are time-sorted. The last one within the hit width is the frontmost in the ZStack.
  private func hoverMark(at pointer: Double, width: Double) {
    let steps = card.source.steps
    let upper = time(pointer + 9, width)
    var low = 0
    var high = steps.count
    while low < high {
      let middle = (low + high) / 2
      if steps[middle].time <= upper { low = middle + 1 } else { high = middle }
    }
    let index = low - 1
    guard steps.indices.contains(index), abs(x(steps[index].time, width) - pointer) <= 9 else {
      return setHoveredMark(nil)
    }
    setHoveredMark(index)
  }

  private func setHoveredMark(_ next: Int?) {
    guard next != hoveredMark else { return }
    let previous = hoveredMark
    hoveredMark = next
    if let next { card.hover(step: next, true) }
    if let previous { card.hover(step: previous, false) }
  }

  private func scrub(width: Double) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
      .onChanged { drag in
        setDragging(true)
        // Pressing the strip takes the arrow keys from a handle, as a click outside it does.
        if card.focusedHandle != nil { card.focusedHandle = nil }
        card.seek(time(drag.location.x, width))
      }
      .onEnded {
        card.seek(time($0.location.x, width))
        setDragging(false)
      }
  }

  private func shade(from start: Double, to end: Double) -> some View {
    Rectangle()
      .fill(Color.black.opacity(0.55))
      .frame(width: max(end - start, 0), height: film)
      .offset(x: start)
      .allowsHitTesting(false)
  }

  /// One end's handle: the range's yellow side and its grip, 16 pt to press, ringed while it
  /// takes the arrow keys.
  private func handle(_ end: RecordingTrim.End, at x: Double, width: Double) -> some View {
    let side = 16.0
    let focused = card.focusedHandle == end
    let label = end == .start ? labels.trimStart : labels.trimEnd
    let value = end == .start ? card.state.trim.start : card.state.trim.end
    return Capsule()
      .fill(Color.black.opacity(0.5))
      .frame(width: 2, height: 12)
      .frame(width: side, height: film)
      .contentShape(Rectangle())
      .overlay {
        if focused {
          RoundedRectangle(cornerRadius: IslandMetrics.recordingFilmRadius, style: .continuous)
            .strokeBorder(Color(nsColor: .keyboardFocusIndicatorColor), lineWidth: 2)
            .padding(-2)
        }
      }
      .modifier(FloatingHover(pointer: .resizeColumn) { _ in })
      .offset(x: end == .start ? x - 3 : x - side + 3)
      .highPriorityGesture(
        // By how far the pointer moved, not where it is: the handle's grip is beside its end.
        DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
          .onChanged {
            setDragging(true)
            card.drag(end, by: $0.translation.width / max(width, 1) * card.source.duration)
          }
          .onEnded { _ in
            card.endDrag()
            setDragging(false)
          }
      )
      .accessibilityElement()
      .accessibilityLabel(Text(verbatim: label))
      .accessibilityValue(Text(verbatim: RecordingClock.text(value)))
      .accessibilityAdjustableAction { direction in
        card.focusedHandle = end
        _ = card.nudge(forward: direction == .increment, shift: false)
      }
  }
}
