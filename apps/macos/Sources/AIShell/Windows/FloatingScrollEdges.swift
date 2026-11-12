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
  /// Content is streaming in: while the viewport is at the end, it stays at the end as the
  /// content grows; scrolling away stops that until the person scrolls back to the end.
  ///
  /// Vertical only. "At the end" is the bottom edge's own test (no bottom fade: the content
  /// fits, or the viewport reaches its end), so following and the fade never disagree. Nothing
  /// scrolls programmatically: the scroll view's size-change anchor keeps the end in place in the
  /// same layout pass as the growth, so a person's scroll is never overridden and a viewport
  /// scrolled away stays where it is. A growing card whose content still fits has nothing to
  /// scroll. While following, the scroll content drops an animation inherited from the change
  /// (its own `animation(_:value:)` still applies), so each growth jumps to the end instead of
  /// springing there, with or without Reduce Motion.
  var follows = false
  @ViewBuilder let edges: (AnswerOverflow) -> Edges

  @State private var overflow = AnswerOverflow()
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  func body(content: Content) -> some View {
    let plain = reduceTransparency || contrast == .increased
    let vertical = axis == .vertical
    let following = follows && vertical && !overflow.bottom
    content
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize)
      .backport.scrollEdgeEffectHidden(true, for: vertical ? .vertical : .horizontal)
      // Both stay applied with neutral values while not following (a nil anchor is the
      // system's), so toggling `follows` keeps the scroll view's identity and its offset.
      .defaultScrollAnchor(following ? .bottom : nil, for: .sizeChanges)
      // A page opened while it streams (paging back to the answer still coming) starts at its
      // newest text, so it follows from its first frame; any other opens at its top.
      .defaultScrollAnchor(follows && vertical ? .bottom : nil, for: .initialOffset)
      .transaction { if following { $0.animation = nil } }
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
  init(axis: Axis = .vertical, reduceMotion: Bool, follows: Bool = false) {
    self.init(axis: axis, reduceMotion: reduceMotion, follows: follows) {
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
