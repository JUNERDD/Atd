import AtdAI
import AtdInk
import SwiftUI

/// Places labels on the stage by the boxes they belong to: each subview is measured, then
/// `CameraLayout.place` keeps them inside the photo, off each other and, where it can, off the
/// photo's text.
struct CameraPinLayout: Layout {
  /// The box each subview belongs to, in the stage's coordinates, in subview order.
  let anchors: [CGRect]
  /// Where labels may go: the photo, a little inset.
  let area: CGRect
  /// The photo's text lines on the stage, which labels keep clear of when there is room.
  var text: [CGRect] = []
  /// Tags try the space beside their box first; translation pins go under their lines.
  var besideFirst = false
  /// The widest a label may be.
  var maxWidth: CGFloat = 220

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    proposal.replacingUnspecifiedDimensions()
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let width = min(maxWidth, area.width)
    let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
    let labels = zip(anchors, sizes).map { CameraLayout.Label(anchor: $0, size: $1) }
    let frames = CameraLayout.place(labels, in: area, avoiding: text, besideFirst: besideFirst)
    for (subview, frame) in zip(subviews, frames) {
      subview.place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(frame.size))
    }
  }
}

/// A number in an ink disc: the same number on the photo and in the sheet.
struct CameraBadge: View {
  let number: Int
  var onPhoto = false

  var body: some View {
    Text(number, format: .number)
      .font(.caption.weight(.bold).monospacedDigit())
      .foregroundStyle(onPhoto ? .white : .primary)
      .frame(minWidth: 20, minHeight: 20)
      .padding(.horizontal, 2)
      .background {
        InkShape(corners: .round, wobble: 0.5, seed: number)
          .fill(onPhoto ? Color.black.opacity(0.82) : InkColor.chosen)
      }
      .dynamicTypeSize(...DynamicTypeSize.xxLarge)
      .accessibilityHidden(true)
  }
}

/// A dark label on the photo: a translation pin or a field's tag.
struct CameraPin<Content: View>: View {
  let number: Int
  @ViewBuilder let content: Content

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      CameraBadge(number: number, onPhoto: true)
      content
    }
    .font(.footnote.weight(.medium))
    .foregroundStyle(.white)
    .lineLimit(1)
    .padding(.leading, 4)
    .padding(.trailing, 10)
    .padding(.vertical, 4)
    .background(.black.opacity(0.78), in: Capsule())
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
  }
}
