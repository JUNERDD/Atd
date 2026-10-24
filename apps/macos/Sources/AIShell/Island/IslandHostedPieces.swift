import AICore
import AppKit
import SwiftUI

// The island's AppKit pieces: its spinner and the progress HUD's shimmering label, hosted in
// SwiftUI so their animations stay in the render server, and drawn without the glass's
// vibrancy, as the HUD's glass bar drew its pieces.

/// The activity indicator in the 16 pt glyph slot (``IslandSpinnerView``: the system small
/// spinner's shape and rhythm in the full label colour, animated in the render server). It goes
/// with the content that holds it, so nothing turns while the island shows anything else or is
/// gone.
struct IslandSpinner: NSViewRepresentable {
  var side = IslandSpinnerStyle.side

  func makeNSView(context: Context) -> IslandPlainHost<IslandSpinnerView> {
    let host = IslandPlainHost(IslandSpinnerView(side: side))
    host.setAccessibilityElement(false)
    return host
  }

  func updateNSView(_ host: IslandPlainHost<IslandSpinnerView>, context: Context) {}

  func sizeThatFits(
    _ proposal: ProposedViewSize, nsView: IslandPlainHost<IslandSpinnerView>, context: Context
  ) -> CGSize? {
    CGSize(width: side, height: side)
  }
}

/// Running text with the page's shimmer: the progress HUD's own ``ShimmerLabel``, a muted label
/// whose band sweeps on a Core Animation animation in the render server (``ShimmerSweep``'s
/// clock and geometry), only while its window is visible and Reduce Motion is off; drawn as it
/// was in the HUD's glass bar, without vibrancy (``IslandPlainHost``). The caller frames it
/// ``width(of:limit:)`` wide, so a long name is cut with an ellipsis and a short one never is.
struct IslandShimmer: NSViewRepresentable {
  let text: String

  /// The width the label takes for `text`, at most `limit`: its cell's own size, which adds
  /// the text field's padding to the glyphs; framed to the bare text width the field would cut
  /// the name with an ellipsis.
  static func width(of text: String, limit: Double) -> Double {
    sizing.stringValue = text
    let size = sizing.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: 10_000, height: 100))
    return min((size?.width ?? 0).rounded(.up), limit)
  }

  /// A label set up as the shimmer's, for measuring.
  private static let sizing: NSTextField = {
    let field = NSTextField(labelWithString: "")
    field.font = AnnotationToolbarButton.Label.font
    field.lineBreakMode = .byTruncatingTail
    return field
  }()

  func makeNSView(context: Context) -> IslandPlainHost<ShimmerLabel> {
    let label = ShimmerLabel(running: text, font: AnnotationToolbarButton.Label.font)
    label.lineBreakMode = .byTruncatingTail
    label.toolTip = text
    return IslandPlainHost(label)
  }

  func updateNSView(_ host: IslandPlainHost<ShimmerLabel>, context: Context) {
    guard host.content.stringValue != text else { return }
    host.content.stringValue = text
    host.content.toolTip = text
  }

  func sizeThatFits(
    _ proposal: ProposedViewSize, nsView: IslandPlainHost<ShimmerLabel>, context: Context
  ) -> CGSize? {
    let fitting = nsView.content.intrinsicContentSize
    return CGSize(width: proposal.width ?? fitting.width, height: fitting.height)
  }
}

/// Holds an AppKit piece of the island as the HUD's glass bar held it. SwiftUI's glass gives the
/// AppKit views it hosts a vibrant appearance and composites them with plus-lighter (dark) or
/// plus-darker (light) blending; inside `NSGlassEffectView` the HUD's pieces had the plain
/// appearance and no blending. So this host opts out of vibrancy and gives `content` the plain
/// counterpart of whatever appearance it inherits, high contrast included, following every
/// change of it. `content` fills the host exactly: laid out at the host's bounds on every
/// layout rather than autoresized, which drifts to fractional, non-square frames as SwiftUI
/// sizes the host and smears a spinner's one-pixel spokes.
final class IslandPlainHost<Content: NSView>: NSView {
  let content: Content

  init(_ content: Content) {
    self.content = content
    super.init(frame: NSRect(origin: .zero, size: content.fittingSize))
    content.frame = bounds
    addSubview(content)
  }

  // Declared, though empty, because Swift 6.2.4's optimizer crashes (EarlyPerfInliner, signal 11)
  // on the synthesized deinit of a generic main-actor class when the deployment target is below
  // macOS 26. Remove once the toolchain no longer does.
  deinit {}

  override func layout() {
    super.layout()
    if content.frame != bounds { content.frame = bounds }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var allowsVibrancy: Bool { false }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    let plain = effectiveAppearance.bestMatch(from: Self.plainAppearances)
    content.appearance = plain.flatMap(NSAppearance.init(named:))
  }

  private static var plainAppearances: [NSAppearance.Name] {
    [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]
  }
}
