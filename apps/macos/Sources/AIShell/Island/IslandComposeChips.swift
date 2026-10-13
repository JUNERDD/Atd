import AICore
import AppKit
import SwiftUI

/// The compose card's attached files: one row of chips in added order that scrolls sideways
/// under the card's fading edges (``IslandFadingScroll``), spanning the card's full width so a
/// chip scrolls out under the fade at the glass's edge rather than being cut at the card's
/// padding; at rest the first chip starts at that padding. An edge that hides chips fades them
/// out and shows an arrow on its fade, a real control: a press scrolls toward that side by about
/// the width the row shows, until the chip that edge cut lands wholly clear of the other edge
/// (``ComposeChipRow``). The arrows come and go with the fades' flags in a 0.12 s ease-out fade,
/// and stay beside the separator that replaces the fade under Reduce Transparency or Increase
/// Contrast. A chip under an arrow is reached by scrolling it clear. A newly attached file
/// scrolls the row to its end, so the chip it added shows.
struct IslandComposeChips: View {
  let model: IslandModel
  let files: [FileRef]
  /// The card that has the pointer and the keyboard; a leaving one is inert.
  let active: Bool

  @State private var position = ScrollPosition(edge: .leading)
  @State private var cut = ComposeChipRow.Cut()

  var body: some View {
    let row = ComposeChipRow(
      widths: files.map { IslandComposeChip.width(of: $0.name) }, margin: IslandMetrics.cardPadding)
    IslandFadingScroll(axis: .horizontal, reduceMotion: model.reduceMotion) {
      HStack(spacing: ComposeChipRow.gap) {
        ForEach(Array(files.enumerated()), id: \.offset) { index, file in
          IslandComposeChip(
            model: model, file: file, index: index, active: active, width: row.widths[index])
        }
      }
      .padding(.horizontal, row.margin)
    } edges: { overflow in
      HStack(spacing: 0) {
        arrow(.leading, shown: overflow.top) { scroll(to: row.offset(revealingLeading: cut)) }
        Spacer(minLength: 0)
        arrow(.trailing, shown: overflow.bottom) {
          scroll(to: row.offset(revealingTrailing: cut))
        }
      }
    }
    .scrollPosition($position)
    .onScrollGeometryChange(for: ComposeChipRow.Cut.self) { geometry in
      row.cut(offset: geometry.contentOffset.x, container: geometry.containerSize.width)
    } action: { _, next in
      cut = next
    }
    .onChange(of: files.count) { before, after in
      if after > before { scroll(toEdge: .trailing) }
    }
    .frame(height: IslandMetrics.composeChipHeight)
    .padding(.horizontal, -IslandMetrics.cardPadding)
  }

  private func scroll(toEdge edge: Edge) {
    withAnimation(model.reduceMotion ? nil : .easeOut(duration: 0.25)) {
      position.scrollTo(edge: edge)
    }
  }

  private func scroll(to offset: Double?) {
    guard let offset else { return }
    withAnimation(model.reduceMotion ? nil : .easeOut(duration: 0.25)) {
      position.scrollTo(x: offset)
    }
  }

  /// The arrow on `edge`'s fade, 2 pt in from the card's edge: shown, and pressable, only while
  /// that edge hides chips.
  private func arrow(_ edge: HorizontalEdge, shown: Bool, action: @escaping () -> Void)
    -> some View
  {
    let labels = model.labels
    return IslandChipArrow(
      glyph: edge == .leading ? IslandIcons.scrollLeft : IslandIcons.scrollRight,
      label: edge == .leading ? labels.composeScrollLeft : labels.composeScrollRight,
      action: action
    )
    .padding(.horizontal, 2)
    .opacity(shown ? 1 : 0)
    .animation(.easeOut(duration: 0.12), value: shown)
    .allowsHitTesting(shown && active)
    .accessibilityHidden(!shown)
  }
}

/// A scroll arrow of the chip row: a small Lucide chevron (``IslandIcons``) in the secondary
/// label colour on the island's button washes (none at rest, light on hover, deeper while
/// pressed), as tall as the row and wider than its fade, named `label` for VoiceOver and its
/// tooltip.
private struct IslandChipArrow: View {
  let glyph: String
  let label: String
  let action: () -> Void
  @State private var hovered = false

  static let width = 20.0

  var body: some View {
    Button(action: action) {
      IslandGlyph(name: glyph, side: 12)
        .foregroundStyle(.secondary)
        .frame(width: Self.width, height: IslandMetrics.composeChipHeight)
    }
    .buttonStyle(IslandWashStyle(shape: Capsule(), hovered: hovered))
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .help(label)
    .accessibilityLabel(Text(verbatim: label))
  }
}

/// An attached file: an image or file glyph by its type (``IslandIcons``), its name, and a
/// button that removes it, on the controls' neutral wash with the field's corner
/// (``IslandMetrics/composeRadius``). It hugs its content up to ``maxNameWidth`` of name, cut in
/// the middle past that; the whole name is its tooltip and what VoiceOver reads. The remove
/// button sits 4 pt inside the chip's end, its corner 4 pt less, so the two are concentric.
struct IslandComposeChip: View {
  let model: IslandModel
  let file: FileRef
  let index: Int
  let active: Bool
  /// ``width(of:)``, which the row's arrows also scroll by.
  let width: Double
  @State private var hovered = false

  /// The longest name before it is cut in the middle.
  static let maxNameWidth = 160.0
  private static let iconSide = 16.0
  private static let removeSide = 20.0
  private static let spacing = 6.0
  private static let trailing = 4.0

  /// A chip's width for a file named `name`: its inset, icon, name as the hint type measures it
  /// (at most ``maxNameWidth``), remove button and the gaps between them.
  static func width(of name: String) -> Double {
    IslandMetrics.rowPadding + iconSide + spacing * 2 + removeSide + trailing
      + IslandType.width(of: name, size: 12, weight: .regular, limit: maxNameWidth)
  }

  var body: some View {
    let remove = model.labels.remove(file.name)
    HStack(spacing: Self.spacing) {
      IslandGlyph(
        name: file.type.hasPrefix("image/") ? IslandIcons.image : IslandIcons.file, side: 14
      )
      .foregroundStyle(.secondary)
      .frame(width: Self.iconSide, height: Self.iconSide)
      Text(verbatim: file.name)
        .font(IslandType.hint)
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button {
        model.composeEvent(.remove(index))
      } label: {
        IslandGlyph(name: AnnotationIcons.cancel, side: 12)
          .frame(width: Self.removeSide, height: Self.removeSide)
      }
      .buttonStyle(
        IslandWashStyle(
          shape: RoundedRectangle(
            cornerRadius: IslandMetrics.composeRadius - Self.trailing, style: .continuous),
          hovered: hovered)
      )
      .onHover { hovered = $0 }
      .pointerStyle(active ? .link : nil)
      .disabled(!active)
      .help(remove)
      .accessibilityLabel(Text(verbatim: remove))
    }
    .foregroundStyle(.primary)
    .padding(.leading, IslandMetrics.rowPadding)
    .padding(.trailing, Self.trailing)
    .frame(width: width, height: IslandMetrics.composeChipHeight)
    .background {
      IslandWash(
        level: 0.06,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.composeRadius, style: .continuous))
    }
    .help(file.name)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: file.name))
  }
}
