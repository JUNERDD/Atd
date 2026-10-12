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

/// The compose card's glyphs: Lucide template image sets in the App target's asset catalog
/// (`App/Assets.xcassets/Island/lucide-<name>.imageset`; `camera` is the mini panel's own set,
/// since asset names are global in the catalog), found in the main bundle by
/// `NSImage(named:)` like every island glyph (``IslandGlyph``). Outside the app bundle (`swift
/// test`) they are missing and the controls keep their tooltips and labels.
///
/// Source: unmodified SVGs from lucide-static 1.48.0 (ISC), the `lucide-react` version pinned in
/// `apps/desktop/package.json`, each from `https://unpkg.com/lucide-static@1.48.0/icons/<name>.svg`
/// for the names below; the attach control and its menu use the panel composer's glyphs.
enum IslandIcons {
  static let attach = "plus"
  static let screenshot = "camera"
  static let files = "paperclip"
  static let image = "image"
  static let file = "file"
  static let warning = "triangle-alert"
  static let scrollLeft = "chevron-left"
  static let scrollRight = "chevron-right"

  /// The glyph `name` at `side` points for a menu item: a copy, so the shared image keeps its
  /// own size.
  static func menuImage(_ name: String, side: Double = 16) -> NSImage? {
    guard let image = MiniPanelIcons.glyph(name).copy() as? NSImage else { return nil }
    image.size = NSSize(width: side, height: side)
    image.isTemplate = true
    return image
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
/// buttons), light on hover, deeper while pressed, in `shape` behind the label. A disabled
/// button is inert: it keeps its rest wash whatever the pointer does.
struct IslandWashStyle<Outline: InsettableShape>: ButtonStyle {
  let shape: Outline
  let hovered: Bool
  var rest = 0.0

  func makeBody(configuration: Configuration) -> some View {
    IslandWashLabel(configuration: configuration, shape: shape, hovered: hovered, rest: rest)
  }
}

/// ``IslandWashStyle``'s label, which reads whether its button is enabled.
private struct IslandWashLabel<Outline: InsettableShape>: View {
  let configuration: ButtonStyleConfiguration
  let shape: Outline
  let hovered: Bool
  let rest: Double
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let level =
      !isEnabled ? rest : configuration.isPressed ? 0.16 : hovered ? 0.09 : rest
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
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    Button(action: action) {
      IslandGlyph(name: glyph)
        .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
    }
    .buttonStyle(IslandWashStyle(shape: Circle(), hovered: hovered))
    .foregroundStyle(.primary)
    .onHover { hovered = $0 }
    .pointerStyle(isEnabled ? .link : nil)
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
  @Environment(\.isEnabled) private var isEnabled

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
    .pointerStyle(isEnabled ? .link : nil)
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

/// The press capsule's charge: a track that fills from the hold's ``CommandHold/reveal``, when
/// the capsule shows, to its ``CommandHold/threshold``, full when the options card opens.
struct IslandMeter: View {
  @State private var charged = false

  var body: some View {
    let width = IslandMetrics.meterWidth
    let charge = (CommandHold.threshold - CommandHold.reveal) / .seconds(1)
    Capsule()
      .fill(Color.primary.opacity(0.12))
      .overlay(alignment: .leading) {
        Capsule()
          .fill(Color.primary.opacity(0.7))
          .frame(width: charged ? width : 0)
          .animation(.linear(duration: charge), value: charged)
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
