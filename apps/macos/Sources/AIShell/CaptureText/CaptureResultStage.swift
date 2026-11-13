import AICore
import Observation
import SwiftUI

/// One presentation of the capture editor's result card in its glass (``CaptureResultStage``): the
/// card or the copied capsule, laid out where it rests and following the shape
/// as drawn, arriving and leaving on its own presence, as the island's contents do
/// (``IslandLayer``). A face stays mounted while it leaves, so the next one arrives into the same
/// shape.
struct CaptureResultFace: Identifiable, Equatable {
  enum Kind: Equatable {
    case card
    /// The copied capsule, saying this.
    case copied(String)

    /// Whether `other` is this face changing in place (another copied text, say) rather than
    /// another face replacing it.
    func isSameFace(as other: Kind) -> Bool {
      switch (self, other) {
      case (.card, .card), (.copied, .copied): true
      default: false
      }
    }

    /// Its glass's corner at `size`: a capsule's half height for the copied capsule, the card's
    /// radius for the card.
    func corner(_ size: CGSize) -> Double {
      if case .copied = self { return size.height / 2 }
      return IslandMetrics.cardRadius
    }
  }

  let id: Int
  var kind: Kind
  /// Where it rests, in the stage's lane.
  var rest: CGRect
  var presence: MiniPanelPresence
}

/// The result card's one glass shape in the capture editor and the faces in it, moving as the
/// command island does (``IslandChoreography``).
///
/// - It enters as the selection toolbar does (the island grows out of a pill instead, as it has no
///   selection to stand beside): the shape springs from ``SelectionToolbarEntrance/startScale``
///   of its size, a little toward the selection it stands beside (from its middle when it has
///   no side), as it fades in and its face arrives with it. It leaves as one piece, the entrance
///   in reverse: its face stays in the glass as both shrink toward the same edge and fade out,
///   eased in over ``IslandChoreography/exitDuration``; a show before it is gone turns it back
///   from where it is.
/// - Between faces it morphs: when the card collapses into the copied capsule, or opens again from
///   it, the shape springs from the frame it had to the new one, what showed leaves
///   as it starts (into a blur, scaling with the shape) and what comes arrives once it has.
/// - A change within the same face (an answer streaming in, a drag) moves the shape at once.
///
/// Under Reduce Motion it only fades in and out, the springs lose their bounce, and the faces keep
/// their own size, revealed by the shape.
///
/// The host (``CaptureResultCardHost``) stands over the lane: where the shown face rests, or,
/// while the shape morphs, that and where it came from together, with the island's transparent
/// room around them (``IslandMetrics/inset``) for the spring's overshoot and the glass's shadow,
/// so none of it is cut. The shape and the faces are in the lane's coordinates.
@Observable final class CaptureResultStage {
  private static let room = IslandMetrics.inset

  private(set) var shape = MiniPanelGlassRect()
  /// The animation of the shape's last change; nil for a jump.
  private(set) var animation: Animation?
  /// The faces mounted, the shown one last.
  private(set) var faces: [CaptureResultFace] = []
  /// The glass's and its faces' opacity together, and the animation of its last change.
  private(set) var opacity = 1.0
  private(set) var fade: Animation?
  /// Where the host stands, in its superview's coordinates.
  @ObservationIgnored private(set) var lane = CGRect.zero
  /// Where the shown face rests, in the host's superview's coordinates; empty while none shows.
  @ObservationIgnored private(set) var placed = CGRect.zero
  /// Leaving, it takes no pointer.
  @ObservationIgnored private(set) var leaving = false
  /// Takes the lane whenever it changes, for the host to stand over it.
  @ObservationIgnored var onLane: (CGRect) -> Void = { _ in }
  /// The point of the shape it grows from and shrinks toward: the edge facing the selection it
  /// stands beside, else its middle (moved, or a capsule).
  @ObservationIgnored private var anchor = UnitPoint.center
  @ObservationIgnored private var nextFace = 0
  /// Counts the changes, so a change's later steps know when a newer one replaced them.
  @ObservationIgnored private var generation = 0

  /// Shows `kind` resting at `frame` (the host's superview's coordinates), standing `beside` that
  /// side of the selection (nil: none, it was moved or is a capsule): entering when nothing
  /// shows; another face morphs into it; the same face stands there at once.
  func show(
    _ kind: CaptureResultFace.Kind, at frame: CGRect, beside side: CaptureResultPlacement.Side?,
    reduceMotion: Bool
  ) {
    anchor = Self.anchor(beside: side)
    let returning = leaving
    if leaving {
      leaving = false
      fadeIn(reduceMotion: reduceMotion)
    }
    guard let shown = faces.last else { return appear(kind, at: frame, reduceMotion: reduceMotion) }
    if shown.kind == kind, frame == placed {
      return returning ? springBack(kind, reduceMotion: reduceMotion) : ()
    }
    if opacity < 1 { fadeIn(reduceMotion: reduceMotion) }
    guard !shown.kind.isSameFace(as: kind) else { return stand(kind, at: frame) }
    morph(to: kind, at: frame, reduceMotion: reduceMotion)
  }

  /// Nothing shows: what showed leaves as one piece, then `gone` hides the host; at once when
  /// nothing showed.
  func leave(reduceMotion: Bool, gone: @escaping @MainActor () -> Void) {
    guard !faces.isEmpty else { return gone() }
    guard !leaving else { return }
    leaving = true
    generation += 1
    let change = generation
    let duration = IslandChoreography.exitDuration
    if !reduceMotion {
      animation = .easeIn(duration: duration)
      shape = Self.shrunk(shape, toward: anchor)
    }
    fade = .easeIn(duration: duration)
    opacity = 0
    after(duration + MiniPanelMotion.frame) { [weak self] in
      guard let self, generation == change else { return }
      leaving = false
      faces = []
      placed = .zero
      gone()
    }
  }

  /// `kind` enters at `frame`: drawn first at its start, hidden, then springing to its rest a
  /// frame later as it fades in.
  private func appear(_ kind: CaptureResultFace.Kind, at frame: CGRect, reduceMotion: Bool) {
    generation += 1
    let change = generation
    placed = frame
    move(to: frame.insetBy(dx: -Self.room, dy: -Self.room))
    let rest = frame.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let resting = MiniPanelGlassRect(rest, corner: kind.corner(frame.size), in: .zero)
    animation = nil
    shape = reduceMotion ? resting : Self.shrunk(resting, toward: anchor)
    fade = nil
    opacity = 0
    let face = mount(
      kind, rest: rest,
      presence: MiniPanelPresence(shown: false, motion: IslandChoreography.entering))
    faces = [face]
    after(MiniPanelMotion.frame) { [weak self] in
      guard let self, generation == change else { return }
      fadeIn(reduceMotion: reduceMotion)
      faces[0].presence = MiniPanelPresence(shown: true, motion: IslandChoreography.entering)
      guard !reduceMotion else { return }
      let entrance = SelectionToolbarEntrance.self
      animation = MiniPanelSpring(entrance.duration, entrance.bounce).animation
      shape = resting
    }
  }

  /// A leave turned back over the same face: the shape springs from where it is to its rest.
  private func springBack(_ kind: CaptureResultFace.Kind, reduceMotion: Bool) {
    generation += 1
    let rest = placed.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let entrance = SelectionToolbarEntrance.self
    animation = reduceMotion ? nil : MiniPanelSpring(entrance.duration, entrance.bounce).animation
    shape = MiniPanelGlassRect(rest, corner: kind.corner(placed.size), in: .zero)
  }

  private func fadeIn(reduceMotion: Bool) {
    let entrance = SelectionToolbarEntrance.self
    fade =
      reduceMotion
      ? .easeInOut(duration: entrance.reducedMotionFade) : .easeOut(duration: entrance.fadeDuration)
    opacity = 1
  }

  /// `kind` at `frame` at once, the faces that were leaving gone.
  private func stand(_ kind: CaptureResultFace.Kind, at frame: CGRect) {
    generation += 1
    placed = frame
    move(to: frame.insetBy(dx: -Self.room, dy: -Self.room))
    let rest = frame.offsetBy(dx: -lane.minX, dy: -lane.minY)
    animation = nil
    shape = MiniPanelGlassRect(rest, corner: kind.corner(frame.size), in: .zero)
    if var face = faces.last {
      face.kind = kind
      face.rest = rest
      face.presence = MiniPanelPresence(shown: true, motion: IslandChoreography.content)
      faces = [face]
    }
  }

  /// What shows leaves and `kind` arrives as the shape springs from where it was to `frame`,
  /// on the island's springs for a shape growing or shrinking that much; the lane then shrinks
  /// to `frame` once the shape rests.
  private func morph(to kind: CaptureResultFace.Kind, at frame: CGRect, reduceMotion: Bool) {
    generation += 1
    let change = generation
    let previous = placed
    placed = frame
    // The lane grows to hold both. Faces and the shape mostly share their top-left corner, so its
    // origin stays; one that moves takes the shape there first, a frame before it springs.
    let union = lane.union(frame.insetBy(dx: -Self.room, dy: -Self.room))
    let shifts = union.origin != lane.origin
    move(to: union)
    guard shifts else {
      return spring(to: kind, at: frame, from: previous, change: change, reduceMotion: reduceMotion)
    }
    after(MiniPanelMotion.frame) { [weak self] in
      guard let self, generation == change else { return }
      spring(to: kind, at: frame, from: previous, change: change, reduceMotion: reduceMotion)
    }
  }

  private func spring(
    to kind: CaptureResultFace.Kind, at frame: CGRect, from previous: CGRect, change: Int,
    reduceMotion: Bool
  ) {
    let leaving = Set(faces.map(\.id))
    for index in faces.indices {
      faces[index].presence = MiniPanelPresence(shown: false, motion: IslandChoreography.content)
    }
    let rest = frame.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let face = mount(
      kind, rest: rest,
      presence: MiniPanelPresence(shown: false, motion: IslandChoreography.content))
    faces.append(face)
    let motion = IslandChoreography.shape(
      from: WindowSize(width: previous.width, height: previous.height),
      to: WindowSize(width: frame.width, height: frame.height), reduceMotion: reduceMotion)
    let from = shape
    animation = motion.animation(thickness: .vertical)
    shape = MiniPanelGlassRect(rest, corner: kind.corner(frame.size), in: .zero)
    let extent = MiniPanelShapeAxis.vertical.extent(of: (shape - from).components)
    let settles = MiniPanelAxisAnimation.restTime(
      motion, across: extent.across, along: extent.along)
    after(MiniPanelMotion.frame) { [weak self] in
      guard let self, let index = faces.lastIndex(where: { $0.id == face.id }),
        index == faces.count - 1
      else { return }
      faces[index].presence = MiniPanelPresence(shown: true, motion: IslandChoreography.replacing)
    }
    after(MiniPanelMotion.frame + IslandChoreography.unmountDelay) { [weak self] in
      self?.faces.removeAll { leaving.contains($0.id) }
    }
    after(settles + MiniPanelMotion.frame) { [weak self] in
      guard let self, generation == change else { return }
      move(to: placed.insetBy(dx: -Self.room, dy: -Self.room))
    }
  }

  /// Stands the lane at `next`, moving the shape and the faces with it so nothing moves on
  /// screen, at once.
  private func move(to next: CGRect) {
    guard next != lane else { return }
    let (dx, dy) = (lane.minX - next.minX, lane.minY - next.minY)
    if dx != 0 || dy != 0 {
      animation = nil
      shape.x += dx
      shape.y += dy
      for index in faces.indices {
        faces[index].rest = faces[index].rest.offsetBy(dx: dx, dy: dy)
      }
    }
    lane = next
    onLane(next)
  }

  private func mount(
    _ kind: CaptureResultFace.Kind, rest: CGRect, presence: MiniPanelPresence
  ) -> CaptureResultFace {
    nextFace += 1
    return CaptureResultFace(id: nextFace, kind: kind, rest: rest, presence: presence)
  }

  /// `shape` at ``SelectionToolbarEntrance/startScale`` of its size about `anchor`, and
  /// ``SelectionToolbarEntrance/rise`` further toward it: where it enters from and leaves to.
  private static func shrunk(_ shape: MiniPanelGlassRect, toward anchor: UnitPoint)
    -> MiniPanelGlassRect
  {
    let entrance = SelectionToolbarEntrance.self
    let (width, height) = (shape.width * entrance.startScale, shape.height * entrance.startScale)
    let pivot = (x: shape.x + shape.width * anchor.x, y: shape.y + shape.height * anchor.y)
    return MiniPanelGlassRect(
      x: pivot.x - width * anchor.x + (anchor.x - 0.5) * 2 * entrance.rise,
      y: pivot.y - height * anchor.y + (anchor.y - 0.5) * 2 * entrance.rise,
      width: width, height: height, corner: shape.corner * entrance.startScale)
  }

  /// The edge facing the selection from `side` of it; the middle with none.
  private static func anchor(beside side: CaptureResultPlacement.Side?) -> UnitPoint {
    switch side {
    case .right: .leading
    case .left: .trailing
    case .below: .top
    case .above: .bottom
    case nil: .center
    }
  }

  private func after(_ seconds: Double, _ body: @escaping @MainActor () -> Void) {
    Task {
      try? await Task.sleep(for: .seconds(seconds))
      body()
    }
  }
}
