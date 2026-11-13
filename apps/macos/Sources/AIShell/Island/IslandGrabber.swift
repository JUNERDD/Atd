import AICore
import SwiftUI

/// What makes a view a handle that moves the island, the capsules' grip (``IslandGrip``) and the
/// result cards' grabber (``IslandGrabber``) alike: the open hand while the pointer is over it, a
/// drag that moves the island within the work area under the closed hand
/// (``IslandPointerHover/beginDrag(in:)`` holds it even where clamping leaves the pointer off the
/// handle), and a double-click that puts it back at home (``GlassHUDPlacement``). The controller
/// follows the pointer itself, since the window moves under the gesture. `highlight` hears
/// whether the handle is under the pointer or being dragged.
struct IslandMoveHandle: ViewModifier {
  let model: IslandModel
  var highlight: (Bool) -> Void = { _ in }
  @State private var hovered = false
  @State private var dragging = false

  func body(content: Content) -> some View {
    content
      .contentShape(Rectangle())
      .modifier(FloatingHover(pointer: .grab) { hovered = $0 })
      .help(model.labels.move)
      .gesture(
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
          .onChanged { _ in
            if !dragging {
              dragging = true
              model.drag(.began)
            }
            model.drag(.moved)
          }
          .onEnded { _ in end() }
      )
      .simultaneousGesture(TapGesture(count: 2).onEnded { model.drag(.reset) })
      .onDisappear { end() }
      .onChange(of: hovered || dragging) { _, highlighted in highlight(highlighted) }
  }

  private func end() {
    guard dragging else { return }
    dragging = false
    model.drag(.ended)
  }
}

/// The result cards' grabber (the answer, review and recording cards): Apple's sheet grabber, a
/// capsule in the tertiary label colour centred in the strip that takes the card's top padding
/// (``IslandMetrics/grabberStrip``), which reads as the card's own handle where the capsules'
/// dotted grip would compete with the title row. It moves the island as the grip does
/// (``IslandMoveHandle``) from ``IslandMetrics/grabberHitWidth`` of the strip, so it need not be
/// hit exactly, and takes the secondary label colour while it is hovered or dragged. Like the
/// grip it is hidden from VoiceOver: the island stays where it shows.
struct IslandGrabber: View {
  let model: IslandModel
  @State private var highlighted = false

  var body: some View {
    IslandGrabberMark(highlighted: highlighted)
      .modifier(IslandMoveHandle(model: model) { highlighted = $0 })
      .frame(maxWidth: .infinity)
      .accessibilityHidden(true)
  }
}

/// The grabber as it looks: the capsule centred in its hit area of the strip, secondary while
/// `highlighted`. The island's grabber and the screenshot text command's result card each attach
/// their own move handle to it.
struct IslandGrabberMark: View {
  let highlighted: Bool

  var body: some View {
    Capsule()
      .fill(highlighted ? HierarchicalShapeStyle.secondary : .tertiary)
      .frame(width: IslandMetrics.grabberWidth, height: IslandMetrics.grabberHeight)
      .frame(width: IslandMetrics.grabberHitWidth, height: IslandMetrics.grabberStrip)
  }
}
