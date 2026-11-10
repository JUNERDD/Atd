import AICore
import SwiftUI

/// Applies the island answer's edge feedback to an existing floating scroll view. Geometry is
/// reduced to two edge flags, so scrolling does not rebuild the view on every offset change.
/// The edge fade owns overflow feedback. A system scroller would add a second, OS-dependent
/// treatment and can flash a gutter during animated layout. Custom thumb overlays stay separate.
/// The glass-sampling edge effect stays off.
struct FloatingScrollEdges<Edges: View>: ViewModifier {
  var axis: Axis = .vertical
  let reduceMotion: Bool
  @ViewBuilder let edges: (AnswerOverflow) -> Edges

  @State private var overflow = AnswerOverflow()
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  func body(content: Content) -> some View {
    let plain = reduceTransparency || contrast == .increased
    let vertical = axis == .vertical
    content
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize)
      .backport.scrollEdgeEffectHidden(true, for: vertical ? .vertical : .horizontal)
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
      .mask { FloatingScrollFade(axis: axis, overflow: plain ? AnswerOverflow() : overflow) }
      .overlay(alignment: vertical ? .top : .leading) { separator(shown: plain && overflow.top) }
      .overlay(alignment: vertical ? .bottom : .trailing) {
        separator(shown: plain && overflow.bottom)
      }
      .overlay { edges(overflow) }
  }

  @ViewBuilder private func separator(shown: Bool) -> some View {
    if axis == .vertical {
      Divider().opacity(shown ? 1 : 0).allowsHitTesting(false).accessibilityHidden(true)
    } else {
      HStack(spacing: 0) { Divider() }
        .opacity(shown ? 1 : 0).allowsHitTesting(false).accessibilityHidden(true)
    }
  }
}

extension FloatingScrollEdges where Edges == EmptyView {
  init(axis: Axis = .vertical, reduceMotion: Bool) {
    self.init(axis: axis, reduceMotion: reduceMotion) {
      _ in EmptyView()
    }
  }
}

/// A fixed mask fades only an edge that hides content; text stays sharp while it scrolls.
private struct FloatingScrollFade: View {
  let axis: Axis
  let overflow: AnswerOverflow

  var body: some View {
    GeometryReader { geometry in
      let size = axis == .vertical ? geometry.size.height : geometry.size.width
      let lengths = overflow.fadeLengths(for: size)
      if axis == .vertical {
        VStack(spacing: 0) {
          edge(fading: overflow.top, from: .top, to: .bottom, length: lengths.top)
          Rectangle()
          edge(fading: overflow.bottom, from: .bottom, to: .top, length: lengths.bottom)
        }
      } else {
        HStack(spacing: 0) {
          edge(fading: overflow.top, from: .leading, to: .trailing, length: lengths.top)
          Rectangle()
          edge(fading: overflow.bottom, from: .trailing, to: .leading, length: lengths.bottom)
        }
      }
    }
  }

  private func edge(fading: Bool, from: UnitPoint, to: UnitPoint, length: CGFloat) -> some View {
    ZStack {
      LinearGradient(colors: [.clear, .black], startPoint: from, endPoint: to)
      Rectangle().opacity(fading ? 0 : 1)
    }
    .frame(
      width: axis == .horizontal ? length : nil, height: axis == .vertical ? length : nil)
  }
}
