import AICore
import SwiftUI

/// The long screenshot card's preview (D11): the whole image at its own shape in the box, the
/// kept range between two yellow handles with the rest shaded, the pages Atd reads split by
/// dashes, and the page under the pointer (here or in its row) outlined in the accent. A handle
/// drags by how far the pointer moved, so a press alone moves nothing; the handle pressed last
/// takes ↑ and ↓ (``IslandLongScreenshot/key(_:)``), and VoiceOver adjusts either one.
///
/// It opens the card's full-screen preview (its lightbox): a click on the image opens it with the
/// clicked row about a third down, and the round button in the box's top-right corner, shown
/// while the pointer is over the box or the button has the keyboard focus, opens it at the top.
/// The image reports its frame (``IslandLongScreenshotCardModel/mediaFrame``), which the
/// lightbox's image grows from and goes back to.
struct IslandLongScreenshotPreview: View {
  let card: IslandLongScreenshotCardModel
  let labels: IslandLongScreenshotLabels
  /// The box the image fits in: the card's measured media.
  let box: WindowSize
  /// The parts of the box under the pointer (the box, the image, a handle, the button): the open
  /// button shows while any is. Each part's hover enters before the one it leaves goes.
  @State private var hovered: Set<String> = []

  var body: some View {
    let size = IslandMetrics.longScreenshotImage(card.source.shot.pointSize, in: box)
    // Preview points per image point.
    let scale = size.height / max(card.state.height, 1)
    ZStack {
      ZStack(alignment: .topLeading) {
        image
          .frame(width: size.width, height: size.height)
          .clipShape(
            RoundedRectangle(
              cornerRadius: IslandMetrics.longScreenshotImageRadius, style: .continuous)
          )
          .overlay {
            RoundedRectangle(
              cornerRadius: IslandMetrics.longScreenshotImageRadius, style: .continuous
            )
            .strokeBorder(Color.primary.opacity(0.14), lineWidth: 0.5)
          }
          .onGeometryChange(for: CGRect.self) {
            $0.frame(in: .global)
          } action: {
            card.mediaFrame = $0
          }
        IslandLongScreenshotMarks(card: card, scale: scale)
          .frame(width: size.width, height: size.height)
          .allowsHitTesting(false)
        // One region follows the pages under the pointer and opens the lightbox on a click; the
        // handles, smaller, win over it.
        Color.clear
          .frame(width: size.width, height: size.height)
          .contentShape(Rectangle())
          .onTapGesture { card.openLightbox($0.y / max(scale, 0.0001), false) }
          .modifier(
            FloatingHover(moved: { card.hoverPreview(at: $0.y / scale) }) {
              hover("image")($0)
              if !$0 { card.hoverPreview(at: nil) }
            }
          )
        ForEach([LongScreenshotCardState.Edge.top, .bottom], id: \.self) { edge in
          IslandLongScreenshotHandle(
            card: card, labels: labels, edge: edge, scale: scale, width: size.width,
            overhang: IslandMetrics.longScreenshotHandleOverhang, space: Self.space,
            hovered: hover(edge == .top ? "top" : "bottom"))
        }
      }
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .coordinateSpace(.named(Self.space))
    }
    .frame(width: box.width, height: box.height)
    .background {
      IslandWash(
        level: 0.06,
        shape: RoundedRectangle(
          cornerRadius: IslandMetrics.longScreenshotPreviewRadius, style: .continuous))
    }
    .modifier(FloatingHover(pointer: .passive) { hover("box")($0) })
    .overlay(alignment: .topTrailing) {
      IslandLongScreenshotOpenButton(
        labels: labels, shown: !hovered.isEmpty, hovered: hover("button")
      ) { card.openLightbox(nil, false) }
      .padding(6)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.preview))
  }

  private static let space = "longScreenshot.preview"

  /// Reports a part of the box entering (true) or leaving the pointer.
  private func hover(_ part: String) -> (Bool) -> Void {
    { inside in
      if inside { hovered.insert(part) } else { hovered.remove(part) }
    }
  }

  /// The image as made for the preview, with what is on it; the box's wash until made.
  @ViewBuilder private var image: some View {
    if let shown = card.displayThumbnail {
      Image(decorative: shown, scale: 1).resizable().interpolation(.high)
    } else {
      Color.clear
    }
  }
}

/// The preview's full-screen button: `maximize-2` in white on a dark 24 pt disc, as the
/// recording's player shows Play, shown while `shown`, while it has the keyboard focus and
/// always under VoiceOver.
private struct IslandLongScreenshotOpenButton: View {
  let labels: IslandLongScreenshotLabels
  let shown: Bool
  let hovered: (Bool) -> Void
  let action: () -> Void
  @State private var over = false
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

  var body: some View {
    Button(action: action) { IslandGlyph(name: IslandIcons.fullScreen, side: 14) }
      .buttonStyle(IslandLongScreenshotOpenStyle(shown: shown || voiceOver, hovered: over))
      .modifier(
        FloatingHover {
          over = $0
          hovered($0)
        }
      )
      .help(labels.lightboxTooltip)
      .accessibilityLabel(Text(verbatim: labels.lightbox))
  }
}

/// The open button's face, which reads the button's own keyboard focus (and reports it, as the
/// island's buttons do: ``IslandControlFocus``).
private struct IslandLongScreenshotOpenStyle: ButtonStyle {
  let shown: Bool
  let hovered: Bool

  func makeBody(configuration: Configuration) -> some View {
    IslandLongScreenshotOpenFace(configuration: configuration, shown: shown, hovered: hovered)
  }
}

private struct IslandLongScreenshotOpenFace: View {
  let configuration: ButtonStyleConfiguration
  let shown: Bool
  let hovered: Bool
  @Environment(\.isFocused) private var isFocused

  var body: some View {
    let side = IslandMetrics.longScreenshotOpenButton
    let visible = shown || isFocused
    configuration.label
      .foregroundStyle(.white)
      .frame(width: side, height: side)
      .background {
        Circle().fill(Color.black.opacity(configuration.isPressed ? 0.7 : hovered ? 0.6 : 0.45))
      }
      .contentShape(Circle())
      .opacity(visible ? 1 : 0)
      .animation(.easeOut(duration: 0.15), value: visible)
      .background { IslandFocusProbe() }
  }
}

/// One end's handle: a yellow bar on the kept range's edge, in a strip 16 pt tall and `overhang`
/// past the image on both sides that takes the pointer, ringed while it takes the arrow keys. It
/// drags by how far the pointer moved in the coordinate space `space`, at `scale` points per
/// image point: the card's preview and the lightbox's overview rail use it alike.
struct IslandLongScreenshotHandle: View {
  let card: IslandLongScreenshotCardModel
  let labels: IslandLongScreenshotLabels
  let edge: LongScreenshotCardState.Edge
  let scale: Double
  let width: Double
  let overhang: Double
  let space: String
  var hovered: (Bool) -> Void = { _ in }

  var body: some View {
    let kept = card.state.kept
    let y = (edge == .top ? kept.top : kept.bottom) * scale
    let hit = IslandMetrics.longScreenshotHandleHit
    let bar = IslandMetrics.longScreenshotHandleBar
    let focused = card.focusedHandle == edge
    Capsule()
      .fill(Color(nsColor: .systemYellow))
      .overlay { Capsule().strokeBorder(Color.black.opacity(0.35), lineWidth: 0.5) }
      .frame(width: width + overhang * 2, height: bar)
      .frame(width: width + overhang * 2, height: hit)
      .contentShape(Rectangle())
      .overlay {
        if focused {
          RoundedRectangle(cornerRadius: 4, style: .continuous)
            .strokeBorder(Color(nsColor: .keyboardFocusIndicatorColor), lineWidth: 2)
            .padding(.vertical, 1)
        }
      }
      .modifier(FloatingHover(pointer: .resizeRow) { hovered($0) })
      .offset(x: -overhang, y: y - hit / 2)
      .highPriorityGesture(
        // By how far the pointer moved, not where it is: the bar is thin beside its strip.
        DragGesture(minimumDistance: 0, coordinateSpace: .named(space))
          .onChanged { card.drag(edge, by: $0.translation.height / max(scale, 0.0001)) }
          .onEnded { _ in card.endDrag() }
      )
      .accessibilityElement()
      .accessibilityLabel(Text(verbatim: edge == .top ? labels.trimTop : labels.trimBottom))
      .accessibilityValue(
        Text(verbatim: IslandLongScreenshotLabels.points(edge == .top ? kept.top : kept.bottom))
      )
      .accessibilityAdjustableAction { direction in
        card.focusedHandle = edge
        _ = card.nudge(down: direction == .increment, shift: false)
      }
  }
}

/// What the preview and the overview rail draw over the image, in their points (`scale` per
/// image point): the shade outside the kept range, the dashed splits between the pages, and the
/// hovered page's accent outline.
struct IslandLongScreenshotMarks: View {
  let card: IslandLongScreenshotCardModel
  let scale: Double

  var body: some View {
    let kept = card.state.kept
    let pages = card.pages
    let hovered = card.hoveredPage
    Canvas { context, size in
      let top = kept.top * scale
      let bottom = kept.bottom * scale
      let shade = GraphicsContext.Shading.color(.black.opacity(0.55))
      context.fill(Path(CGRect(x: 0, y: 0, width: size.width, height: top)), with: shade)
      context.fill(
        Path(CGRect(x: 0, y: bottom, width: size.width, height: max(size.height - bottom, 0))),
        with: shade)
      for (index, page) in pages.enumerated() {
        let y = page.top * scale
        if index > 0 {
          var split = Path()
          split.move(to: CGPoint(x: 0, y: y))
          split.addLine(to: CGPoint(x: size.width, y: y))
          context.stroke(
            split, with: .color(.white.opacity(0.9)),
            style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
        if index == hovered {
          let frame = CGRect(
            x: 0, y: y, width: size.width, height: (page.bottom - page.top) * scale)
          context.stroke(
            Path(frame.insetBy(dx: 1, dy: 1)), with: .color(.accentColor), lineWidth: 2)
        }
      }
    }
    .accessibilityHidden(true)
  }
}
