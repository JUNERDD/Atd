import AICore
import SwiftUI

/// A scroll view of the island's cards whose edges fade out what they hide: the answer card's
/// answer, scrolling vertically between its title and its footer, and the compose card's
/// attachment chips, scrolling sideways. Where more of the content is hidden past an edge, that
/// edge fades it out over ``AnswerOverflow/fadeHeight``: a static gradient mask on the scroll
/// view's frame, so the content stays sharp and the fade stays put while the content moves, at
/// the cost of one offscreen pass over it. The system's scroll edge effect is off: it samples
/// what lies behind it with backdrop layers and a variable blur, which inside the island's own
/// glass is glass sampling glass, and it is meant for controls floating over content, which the
/// cards' titles and footers are not.
///
/// The overflow along `axis` is reduced to two flags (``AnswerOverflow``: `top` the start edge,
/// `bottom` the end edge), so the view changes only when a scroll crosses an edge. Under Reduce
/// Transparency or Increase Contrast a 1 pt separator takes the fade's place, as the clearer
/// edge; under Reduce Motion the change is not animated. `edges` draws over the scroll view,
/// unmasked, from the same flags (the chip row's arrows); the answer card draws nothing there.
struct IslandFadingScroll<Content: View, Edges: View>: View {
  var axis: Axis = .vertical
  let reduceMotion: Bool
  @ViewBuilder let content: Content
  @ViewBuilder let edges: (AnswerOverflow) -> Edges

  @State private var overflow = AnswerOverflow()
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    let plain = reduceTransparency || contrast == .increased
    let vertical = axis == .vertical
    ScrollView(vertical ? .vertical : .horizontal) { content }
      .scrollEdgeEffectHidden(true, for: vertical ? .vertical : .horizontal)
      .onScrollGeometryChange(for: AnswerOverflow.self) { geometry in
        vertical
          ? AnswerOverflow(
            offset: geometry.contentOffset.y, content: geometry.contentSize.height,
            container: geometry.containerSize.height, insetTop: geometry.contentInsets.top,
            insetBottom: geometry.contentInsets.bottom)
          : AnswerOverflow(
            offset: geometry.contentOffset.x, content: geometry.contentSize.width,
            container: geometry.containerSize.width, insetTop: geometry.contentInsets.leading,
            insetBottom: geometry.contentInsets.trailing)
      } action: { _, next in
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) { overflow = next }
      }
      .mask { IslandScrollFade(axis: axis, overflow: plain ? AnswerOverflow() : overflow) }
      .overlay(alignment: vertical ? .top : .leading) { separator(shown: plain && overflow.top) }
      .overlay(alignment: vertical ? .bottom : .trailing) {
        separator(shown: plain && overflow.bottom)
      }
      .overlay { edges(overflow) }
  }

  /// A system divider across the scroll axis: a line across the top or bottom of a vertical
  /// scroll, down the side of a horizontal one.
  @ViewBuilder private func separator(shown: Bool) -> some View {
    if axis == .vertical {
      Divider().opacity(shown ? 1 : 0).accessibilityHidden(true)
    } else {
      HStack(spacing: 0) { Divider() }.opacity(shown ? 1 : 0).accessibilityHidden(true)
    }
  }
}

extension IslandFadingScroll where Edges == EmptyView {
  /// A fading scroll with nothing drawn over its edges: the answer card's.
  init(axis: Axis = .vertical, reduceMotion: Bool, @ViewBuilder content: () -> Content) {
    self.init(axis: axis, reduceMotion: reduceMotion, content: content) { _ in EmptyView() }
  }
}

/// The fading scroll's mask: opaque, except over ``AnswerOverflow/fadeHeight`` at an edge with
/// more of the content past it, where it fades to clear. Each edge is a gradient under an opaque
/// band whose opacity hides it, so the fade comes and goes as an opacity change.
private struct IslandScrollFade: View {
  let axis: Axis
  let overflow: AnswerOverflow

  var body: some View {
    if axis == .vertical {
      VStack(spacing: 0) {
        edge(fading: overflow.top, from: .top, to: .bottom)
        Rectangle()
        edge(fading: overflow.bottom, from: .bottom, to: .top)
      }
    } else {
      HStack(spacing: 0) {
        edge(fading: overflow.top, from: .leading, to: .trailing)
        Rectangle()
        edge(fading: overflow.bottom, from: .trailing, to: .leading)
      }
    }
  }

  /// The band at one edge: clear at `from`, the outer edge, opaque toward `to`.
  private func edge(fading: Bool, from: UnitPoint, to: UnitPoint) -> some View {
    let length = AnswerOverflow.fadeHeight
    return ZStack {
      LinearGradient(colors: [.clear, .black], startPoint: from, endPoint: to)
      Rectangle().opacity(fading ? 0 : 1)
    }
    .frame(
      width: axis == .horizontal ? length : nil, height: axis == .vertical ? length : nil)
  }
}
