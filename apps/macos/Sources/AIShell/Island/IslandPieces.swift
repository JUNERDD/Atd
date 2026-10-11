import AICore
import AppKit
import SwiftUI

/// The parts the island's contents are built from, in the vocabulary of the glass HUDs
/// (``GlassHUDPieces``) and the mini panel: 13 pt medium labels, 12 pt secondary hints with the
/// page's `Kbd` keycaps, round 32 pt buttons on neutral washes, never glass on glass. Every part
/// is plain SwiftUI, so it scales, fades and blurs with the content it rides in.
enum IslandType {
  static let label = Font.system(size: 13, weight: .medium)
  static let hint = Font.system(size: 12)
  static let keycap = Font.system(size: 12, weight: .medium)

  /// The width a single line of `text` takes in the system font of `size` and `weight`, at most
  /// `limit`: a frame that wide shows it whole, or cut with an ellipsis past the limit.
  static func width(
    of text: String, size: CGFloat = 13, weight: NSFont.Weight = .medium, limit: Double
  ) -> Double {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    let measured = (text as NSString).size(withAttributes: [.font: font]).width
    return min((measured + 1).rounded(.up), limit)
  }
}

/// A Lucide template glyph from the app's assets (``MiniPanelIcons/glyph(_:)``).
struct IslandGlyph: View {
  let name: String
  var side = IslandMetrics.glyphSide

  var body: some View {
    Image(nsImage: MiniPanelIcons.glyph(name))
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

/// A neutral wash in the label colour under a hovered or pressed control, with a visible edge
/// under Increase Contrast.
struct IslandWash<Outline: InsettableShape>: View {
  let level: Double
  let shape: Outline
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    shape
      .fill(Color.primary.opacity(level))
      .overlay {
        if contrast == .increased, level > 0 {
          shape.strokeBorder(Color.primary.opacity(0.6), lineWidth: 1)
        }
      }
  }
}

/// The toolbars' button washes (`AnnotationToolbarButton`): `rest` at rest (none on the HUD's
/// buttons), light on hover, deeper while pressed, in `shape` behind the label.
struct IslandWashStyle<Outline: InsettableShape>: ButtonStyle {
  let shape: Outline
  let hovered: Bool
  var rest = 0.0

  func makeBody(configuration: Configuration) -> some View {
    let level = configuration.isPressed ? 0.16 : hovered ? 0.09 : rest
    configuration.label
      .background { IslandWash(level: level, shape: shape) }
      .contentShape(shape)
  }
}

/// A round button of the toolbars' size with a 16 pt glyph in the label colour, as the HUD's
/// close button was; named `label` for VoiceOver and its tooltip.
struct IslandIconButton: View {
  let glyph: String
  let label: String
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      IslandGlyph(name: glyph)
        .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
    }
    .buttonStyle(IslandWashStyle(shape: Circle(), hovered: hovered))
    .foregroundStyle(.primary)
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .help(label)
    .accessibilityLabel(Text(verbatim: label))
  }
}

/// A labelled button as the toolbars draw one: the label type, 10 pt in from each end, a
/// control's height, on the toolbars' capsule washes; `rest` gives it a fill at rest (the
/// options card's Run).
struct IslandTextButton<Trailing: View>: View {
  let title: String
  var tooltip: String?
  var rest = 0.0
  let action: () -> Void
  @ViewBuilder var trailing: () -> Trailing
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(verbatim: title).font(IslandType.label).lineLimit(1)
        trailing()
      }
      .padding(.horizontal, 10)
      .frame(height: IslandMetrics.controlSide)
    }
    .buttonStyle(IslandWashStyle(shape: Capsule(), hovered: hovered, rest: rest))
    .foregroundStyle(.primary)
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .help(tooltip ?? title)
  }
}

extension IslandTextButton where Trailing == EmptyView {
  init(title: String, tooltip: String? = nil, action: @escaping () -> Void) {
    self.init(title: title, tooltip: tooltip, action: action) { EmptyView() }
  }
}

/// One key as the page's `Kbd` draws it: 20 pt tall, 12 pt medium, on a muted fill.
struct IslandKeycap: View {
  let symbol: String

  var body: some View {
    Text(verbatim: symbol)
      .font(IslandType.keycap)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 4)
      .frame(minWidth: GlassHUDPieces.keycapHeight, minHeight: GlassHUDPieces.keycapHeight)
      .background { Capsule().fill(Color.primary.opacity(0.08)) }
      .fixedSize()
  }
}

/// A hint translated around ``GlassHUDPieces/keysMarker``, its keys as keycaps wherever the
/// language puts them.
struct IslandHint: View {
  let template: String
  let keys: [String]

  var body: some View {
    let parts = template.components(separatedBy: GlassHUDPieces.keysMarker)
    HStack(spacing: 4) {
      ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
        let trimmed = part.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
          Text(verbatim: trimmed).font(IslandType.hint).foregroundStyle(.secondary)
        }
        if index < parts.count - 1 {
          ForEach(keys, id: \.self) { IslandKeycap(symbol: $0) }
        }
      }
    }
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      Text(
        verbatim: template.replacingOccurrences(of: GlassHUDPieces.keysMarker, with: keys.joined()))
    )
  }
}

/// A key and what it does, for the options card's footer.
struct IslandKeyHint: View {
  let keys: String
  let label: String

  var body: some View {
    HStack(spacing: 4) {
      IslandKeycap(symbol: keys)
      Text(verbatim: label).font(IslandType.hint).foregroundStyle(.secondary).lineLimit(1)
    }
    .fixedSize()
  }
}

/// The press capsule's charge: a track that fills over ``CommandHold/threshold`` from the press,
/// full when the options card opens.
struct IslandMeter: View {
  @State private var charged = false

  var body: some View {
    let width = IslandMetrics.meterWidth
    let threshold = CommandHold.threshold / .seconds(1)
    Capsule()
      .fill(Color.primary.opacity(0.12))
      .overlay(alignment: .leading) {
        Capsule()
          .fill(Color.primary.opacity(0.7))
          .frame(width: charged ? width : 0)
          .animation(.linear(duration: threshold), value: charged)
      }
      .frame(width: width, height: IslandMetrics.meterHeight)
      .onAppear { charged = true }
      .accessibilityHidden(true)
  }
}

/// The drag handle, as the HUD's (``AnnotationBarGrip``: 16 × 28 pt, the glyph in the label
/// colour): it moves the island within the work area, and a double-click puts it back
/// at home (``GlassHUDPlacement``). The controller follows the pointer itself, since the window
/// moves under the gesture.
struct IslandGrip: View {
  let model: IslandModel
  @State private var dragging = false

  var body: some View {
    IslandGlyph(name: AnnotationIcons.grip)
      .foregroundStyle(.primary)
      .frame(width: IslandMetrics.gripWidth, height: IslandMetrics.controlSide)
      .contentShape(Rectangle())
      .pointerStyle(.grabIdle)
      .help(model.labels.move)
      .gesture(
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
          .onChanged { _ in
            if !dragging {
              dragging = true
              model.drag(.began)
            }
            model.drag(.moved)
          }
          .onEnded { _ in
            dragging = false
            model.drag(.ended)
          }
      )
      .simultaneousGesture(TapGesture(count: 2).onEnded { model.drag(.reset) })
      .accessibilityHidden(true)
  }
}
