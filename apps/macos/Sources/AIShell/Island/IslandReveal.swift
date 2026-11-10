import SwiftUI

/// Content that comes or goes in place without a jump: laid out whole and shown at `fraction`
/// of its height from its top, so what sits after it moves along as it grows or shrinks.
/// Animated, `fraction` lays the content out again on every frame, as the island's reflowing
/// cards are (``IslandLayer/reflows``), so the two never pull against each other.
struct IslandReveal: Layout {
  var fraction: Double

  var animatableData: Double {
    get { fraction }
    set { fraction = newValue }
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let content = subviews.first else { return .zero }
    let size = content.sizeThatFits(proposal)
    return CGSize(width: size.width, height: size.height * fraction)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    subviews.first?.place(
      at: bounds.origin, anchor: .topLeading,
      proposal: ProposedViewSize(width: bounds.width, height: nil))
  }
}

extension View {
  /// This view shown whole or not at all, its height and opacity changing together on
  /// `animation`; `clips` cuts it at the height it has meanwhile, where it would otherwise
  /// overlap what follows.
  @ViewBuilder func islandRevealed(_ shown: Bool, clips: Bool = true, animation: Animation)
    -> some View
  {
    let revealed = IslandReveal(fraction: shown ? 1 : 0) { opacity(shown ? 1 : 0) }
    Group {
      if clips { revealed.clipped() } else { revealed }
    }
    .animation(animation, value: shown)
  }
}
