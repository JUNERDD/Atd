import AICore
import SwiftUI

/// The long screenshot lightbox's overview rail, right of the viewer and in place of its scroll
/// indicators: the whole image fitted to the rail (the card's preview image, covered and
/// annotated as the card shows it), with the card's marks on it (the shade outside the kept
/// range, the page splits, the hovered page), its two trim handles, which drag as the card's do,
/// and the viewport, the rows the viewer shows between the bars. Dragging the viewport scrolls
/// the viewer; a press elsewhere on the rail centres the viewport there first, then drags it.
struct LongScreenshotRail: View {
  let content: IslandLongScreenshotLightbox
  /// The viewport's drag: the visible top when it began and the pointer's y then (rail points).
  @State private var drag: (top: CGFloat, start: CGFloat)?

  private static let space = "longScreenshot.rail"

  var body: some View {
    let layout = content.viewport.layout
    let frame = layout.railImage
    let scale = layout.railScale
    let card = content.card
    let labels = content.labels
    ZStack(alignment: .topLeading) {
      Group {
        if let image = card.displayThumbnail {
          Image(decorative: image, scale: 1).resizable().interpolation(.high)
        } else {
          Color.primary.opacity(0.06)
        }
      }
      .frame(width: frame.width, height: frame.height)
      .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
          .strokeBorder(Color.primary.opacity(0.14), lineWidth: 0.5)
      }
      IslandLongScreenshotMarks(card: card, scale: scale)
        .frame(width: frame.width, height: frame.height)
        .allowsHitTesting(false)
      LongScreenshotRailViewport(
        content: content, scale: scale, width: frame.width, dragging: drag != nil)
      if !content.annotating {
        ForEach([LongScreenshotCardState.Edge.top, .bottom], id: \.self) { edge in
          IslandLongScreenshotHandle(
            card: card, labels: labels, edge: edge, scale: scale, width: frame.width,
            overhang: 6, space: Self.space)
        }
      }
    }
    .frame(width: frame.width, height: frame.height, alignment: .topLeading)
    .coordinateSpace(.named(Self.space))
    .contentShape(Rectangle())
    .gesture(
      DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
        .onChanged { moved($0, scale: scale) }
        .onEnded { _ in drag = nil }
    )
    // A press here acts: it moves the viewer.
    .modifier(FloatingHover { _ in })
    .position(x: frame.midX, y: frame.midY)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.overview))
  }

  /// A press outside the viewport centres it on the pressed row first; then the viewport follows
  /// the pointer by how far it moved.
  private func moved(_ value: DragGesture.Value, scale: CGFloat) {
    let viewer = content.viewer
    if drag == nil {
      let visible = content.viewport.visible
      let row = value.startLocation.y / scale
      if !visible.contains(row) {
        viewer.scrollRail(visibleTop: row - (visible.upperBound - visible.lowerBound) / 2)
      }
      drag = (content.viewport.visible.lowerBound, value.startLocation.y)
    }
    guard let drag else { return }
    viewer.scrollRail(visibleTop: drag.top + (value.location.y - drag.start) / max(scale, 0.0001))
  }
}

/// The rows the viewer shows, outlined on the rail: white over a dark edge, 3 pt past the image
/// on both sides, at least 10 pt tall. It shows the open hand, closed while dragged.
private struct LongScreenshotRailViewport: View {
  let content: IslandLongScreenshotLightbox
  let scale: CGFloat
  let width: CGFloat
  let dragging: Bool

  var body: some View {
    let visible = content.viewport.visible
    let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
    shape
      .fill(Color.white.opacity(0.12))
      .overlay { shape.strokeBorder(Color.white.opacity(0.95), lineWidth: 1.5) }
      .overlay { shape.inset(by: -1).strokeBorder(Color.black.opacity(0.35), lineWidth: 1) }
      .frame(
        width: width + 6, height: max(10, (visible.upperBound - visible.lowerBound) * scale)
      )
      .modifier(FloatingHover(pointer: dragging ? .grabbing : .grab) { _ in })
      .help(content.labels.viewportTooltip)
      .offset(x: -3, y: visible.lowerBound * scale)
      .accessibilityHidden(true)
  }
}
