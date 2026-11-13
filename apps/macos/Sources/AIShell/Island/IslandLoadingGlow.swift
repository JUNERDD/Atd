import AICore
import SwiftUI

/// Mounts ``IslandLoadingGlow`` only while working/writing or retreating into the next state,
/// so idle, recording, long-screenshot, and settled cards never retain a hidden `MeshGradient`.
struct IslandLoadingGlowHost: View {
  let model: IslandModel
  @State private var mounted = false
  @State private var fadeOutTask: Task<Void, Never>?

  var body: some View {
    let kind = model.layers.last?.content.kind
    let loading = kind == .working || kind == .writing
    Group {
      if loading || mounted {
        IslandLoadingGlow(model: model, loading: loading, kind: kind)
      }
    }
    .onChange(of: loading, initial: true) { _, nowLoading in
      fadeOutTask?.cancel()
      if nowLoading {
        mounted = true
      } else if mounted {
        let duration =
          model.reduceMotion
          ? IslandGlowStyle.reducedMotionDuration
          : IslandGlowStyle.exitDuration
        fadeOutTask = Task {
          try? await Task.sleep(for: .seconds(duration + 0.05))
          guard !Task.isCancelled else { return }
          mounted = false
        }
      }
    }
    .onChange(of: model.layers.isEmpty) { _, empty in
      guard empty else { return }
      fadeOutTask?.cancel()
      mounted = false
    }
    .onDisappear {
      fadeOutTask?.cancel()
      mounted = false
    }
  }
}

/// One field for the whole command: changing its text from working to writing never remounts it.
struct IslandLoadingGlow: View {
  let model: IslandModel
  let loading: Bool
  let kind: IslandContent.Kind?
  @State private var entered = false
  @State private var activeSize: CGSize?

  var body: some View {
    let shape = model.shape
    // Freeze the MeshGradient host at its working-capsule size during retreat so expanding into
    // a card never reallocates a card-sized MeshGradient backing store while fading out.
    let hostSize = loading ? shape.frame.size : (activeSize ?? shape.frame.size)
    let rest = CGRect(origin: shape.frame.origin, size: hostSize)
    let fadeDuration =
      model.reduceMotion
      ? IslandGlowStyle.reducedMotionDuration
      : (loading ? IslandGlowStyle.entryDuration : IslandGlowStyle.exitDuration)
    IslandWorkingGlow(active: loading)
      .frame(width: rest.width, height: rest.height)
      .animation(.easeInOut(duration: fadeDuration)) {
        // Keep the fade with the island's morph. The nested AppKit host can resize and
        // reparent as a capsule opens into an answer card without resetting this opacity.
        $0.opacity(loading && entered ? 1 : 0)
      }
      .onAppear {
        entered = true
        if loading { activeSize = shape.frame.size }
      }
      .onChange(of: shape.frame.size) { _, newSize in
        if loading { activeSize = newSize }
      }
      .onChange(of: loading) { _, nowLoading in
        if nowLoading { activeSize = shape.frame.size }
      }
      .animation(.easeInOut(duration: IslandGlowStyle.hueDuration)) {
        // A cyan shift marks insertion without interrupting the same flowing field.
        $0.hueRotation(.degrees(kind == .writing || kind == .done ? IslandGlowStyle.writingHue : 0))
      }
      .animation(shape.animation) {
        $0.modifier(IslandGlowFollowEffect(drawn: shape.glass.rect, rest: rest))
      }
      .animation(nil) {
        let shift = IslandMetrics.canvasShift(model.canvas)
        return $0.offset(x: rest.minX + shift.x, y: rest.minY + shift.y)
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// Fill both axes of the glass during a morph without laying out the mesh on every frame.
/// Unlike text, the background must cover the whole shape rather than preserve its aspect ratio,
/// so it moves as the glass does: this opaque vector takes the same length spring as the glass's
/// erased outline and its clip. A ``MiniPanelGlassRect`` would take a spring per axis
/// (``MiniPanelAxisAnimation``), and on a morph the field would part from the glass's edge,
/// leaving a band of bare fill along the edge the card grows from.
private struct IslandGlowFollowEffect: GeometryEffect {
  var drawn: CGRect
  let rest: CGRect

  var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>>
  {
    get { .init(.init(drawn.minX, drawn.minY), .init(drawn.width, drawn.height)) }
    set {
      drawn = CGRect(
        x: newValue.first.first, y: newValue.first.second,
        width: newValue.second.first, height: newValue.second.second)
    }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    guard rest.width > 0, rest.height > 0 else { return ProjectionTransform() }
    return ProjectionTransform(
      CGAffineTransform(translationX: drawn.minX - rest.minX, y: drawn.minY - rest.minY)
        .scaledBy(x: drawn.width / rest.width, y: drawn.height / rest.height))
  }
}
