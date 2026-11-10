import AICore
import SwiftUI

/// A scroll view for an island card. Edge feedback is shared with the other floating surfaces;
/// `edges` adds the attachment row's arrows without masking the controls themselves.
struct IslandFadingScroll<Content: View, Edges: View>: View {
  var axis: Axis = .vertical
  let reduceMotion: Bool
  @ViewBuilder let content: Content
  @ViewBuilder let edges: (AnswerOverflow) -> Edges

  var body: some View {
    ScrollView(axis == .vertical ? .vertical : .horizontal) { content }
      .modifier(
        FloatingScrollEdges(axis: axis, reduceMotion: reduceMotion, edges: edges))
  }
}

extension IslandFadingScroll where Edges == EmptyView {
  init(
    axis: Axis = .vertical, reduceMotion: Bool,
    @ViewBuilder content: () -> Content
  ) {
    self.init(axis: axis, reduceMotion: reduceMotion, content: content) { _ in EmptyView() }
  }
}
