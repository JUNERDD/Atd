import AICore
import SwiftUI

/// Fixed content keeps interpolation in SwiftUI's render graph. Reflow needs presentation
/// values for layout as well; its descendants must not start independent geometry animations.
enum IslandLayoutMotion {
  case fixed, interpolated
}

/// The common island animation boundary. Its policy describes layout work, not business kinds.
/// A fixed layout pays no per-frame view-body cost; reflow uses one persistent presentation
/// clock for the glass and its layout payload. Both use the same outline and follow transform.
struct IslandSurface<Layout: VectorArithmetic, Content: View>: View {
  let frame: AnimatablePair<MiniPanelGlassRect, Layout>
  let canvas: WindowSize
  let animation: Animation?
  let layoutMotion: IslandLayoutMotion
  let content: Content

  var body: some View {
    let interpolated = layoutMotion == .interpolated
    IslandSurfaceFrame(
      frame: frame, canvas: canvas, animation: interpolated ? nil : animation, content: content
    )
    .animation(interpolated ? animation : nil, value: frame)
  }
}

private struct IslandSurfaceFrame<Layout: VectorArithmetic, Content: View>: View, Animatable {
  var frame: AnimatablePair<MiniPanelGlassRect, Layout>
  let canvas: WindowSize
  let animation: Animation?
  let content: Content

  var animatableData: AnimatablePair<MiniPanelGlassRect, Layout> {
    get { frame }
    set { frame = newValue }
  }

  var body: some View {
    content
      .environment(\.[island: IslandPresentationKey<Layout>()], frame)
      .environment(\.islandContentAnimation, animation)
      .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
      .glassSurface(in: IslandGlassOutline(shape: frame.first), animation: animation)
      .backport.glassEffectTransition(.identity)
      .backport.glassEffectContainer()
      .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
      .transaction { $0.animation = nil }
      .environment(\.colorScheme, GlassSurface.colorScheme)
  }
}

/// A typed environment slot passes the layout policy's target or presentation frame without
/// reconstructing the content tree. Only the thin layer placement views read this value.
nonisolated struct IslandPresentationKey<Layout: VectorArithmetic>: EnvironmentKey, Hashable {
  static var defaultValue: AnimatablePair<MiniPanelGlassRect, Layout> { .zero }
}

extension EnvironmentValues {
  var islandContentAnimation: Animation? {
    get { self[IslandContentAnimationKey.self] }
    set { self[IslandContentAnimationKey.self] = newValue }
  }

  nonisolated subscript<Layout: VectorArithmetic>(island key: IslandPresentationKey<Layout>)
    -> AnimatablePair<MiniPanelGlassRect, Layout>
  {
    get { self[IslandPresentationKey<Layout>.self] }
    set { self[IslandPresentationKey<Layout>.self] = newValue }
  }
}

private struct IslandContentAnimationKey: EnvironmentKey {
  static let defaultValue: Animation? = nil
}

/// The outline uses the default canvas's coordinates. The extra canvas shift comes from its
/// bounds, so reserving more drawing room does not alter the shape's animation coordinates.
struct IslandGlassOutline: Shape {
  var shape: MiniPanelGlassRect

  var animatableData: MiniPanelGlassRect {
    get { shape }
    set { shape = newValue }
  }

  func path(in bounds: CGRect) -> Path {
    let shift = IslandMetrics.canvasShift(
      WindowSize(width: bounds.width, height: bounds.height))
    var shifted = shape
    shifted.x += shift.x
    shifted.y += shift.y
    return MiniPanelGlassOutline(shape: shifted).path(in: bounds)
  }
}
