import AICore
import SwiftUI

/// The answer card's scrolling answer, between its title and its footer. Where more of the
/// answer is hidden past an edge, that edge fades it out over ``AnswerOverflow/fadeHeight``: a
/// static gradient mask on the scroll view's frame, so the text stays sharp and the fade stays
/// put while the answer moves, at the cost of one offscreen pass over the card's text. The
/// system's scroll edge effect is off: it samples what lies behind it with backdrop layers and a
/// variable blur, which inside the island's own glass is glass sampling glass, and it is meant
/// for controls floating over content, which the card's title and footer are not.
///
/// The overflow is reduced to two flags (``AnswerOverflow``), so the view changes only when a
/// scroll crosses an edge. Under Reduce Transparency or Increase Contrast a separator takes the
/// fade's place, as the clearer edge; under Reduce Motion the change is not animated.
struct IslandAnswerScroll<Content: View>: View {
  let reduceMotion: Bool
  @ViewBuilder let content: Content

  @State private var overflow = AnswerOverflow()
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    let plain = reduceTransparency || contrast == .increased
    ScrollView(.vertical) { content }
      .scrollEdgeEffectHidden(true, for: .vertical)
      .onScrollGeometryChange(for: AnswerOverflow.self) { geometry in
        AnswerOverflow(
          offset: geometry.contentOffset.y, content: geometry.contentSize.height,
          container: geometry.containerSize.height, insetTop: geometry.contentInsets.top,
          insetBottom: geometry.contentInsets.bottom)
      } action: { _, next in
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) { overflow = next }
      }
      .mask { IslandAnswerFade(overflow: plain ? AnswerOverflow() : overflow) }
      .overlay(alignment: .top) { separator(shown: plain && overflow.top) }
      .overlay(alignment: .bottom) { separator(shown: plain && overflow.bottom) }
  }

  private func separator(shown: Bool) -> some View {
    Divider().opacity(shown ? 1 : 0).accessibilityHidden(true)
  }
}

/// The answer's mask: opaque, except over ``AnswerOverflow/fadeHeight`` at an edge with more of
/// the answer past it, where it fades to clear. Each edge is a gradient under an opaque band
/// whose opacity hides it, so the fade comes and goes as an opacity change.
private struct IslandAnswerFade: View {
  let overflow: AnswerOverflow

  var body: some View {
    VStack(spacing: 0) {
      edge(fading: overflow.top, toward: .top)
      Rectangle()
      edge(fading: overflow.bottom, toward: .bottom)
    }
  }

  private func edge(fading: Bool, toward edge: VerticalEdge) -> some View {
    ZStack {
      LinearGradient(
        colors: [.clear, .black], startPoint: edge == .top ? .top : .bottom,
        endPoint: edge == .top ? .bottom : .top)
      Rectangle().opacity(fading ? 0 : 1)
    }
    .frame(height: AnswerOverflow.fadeHeight)
  }
}
