import AppKit
import SwiftUI

/// A result card's text (``IslandAnswerText``, ``IslandAskAnswerText``): ``ResultTextContent``,
/// rendered once for every view and measurement of it (``ResultTextRenders``), in a read-only,
/// selectable text view (``ResultTextView``).
///
/// Its size comes from the off-screen measure (``ResultTextMeasure``) for the width proposed, or,
/// with none (a card's width probe), as wide as its widest line up to `maxWidth`. The card's
/// measurements build views that never reach a window; a view makes its text view only once it
/// does, so measuring lays no text out twice. The text view takes the scheme the card pins in
/// SwiftUI's environment, which an AppKit view does not inherit, and its hover region the
/// island's pointer tracking: the I-beam over the text, the pointing hand over a link.
struct ResultText: NSViewRepresentable {
  let content: ResultTextContent
  /// The widest the text lays out when no width is proposed.
  let maxWidth: CGFloat
  /// Takes a clicked link first; true when it handled it. Web and mail links open otherwise.
  var openLink: ((URL) -> Bool)?

  func makeNSView(context: Context) -> ResultTextHost { ResultTextHost() }

  func updateNSView(_ host: ResultTextHost, context: Context) {
    host.text = content.rendered
    host.openLink = openLink
    host.dark = context.environment.colorScheme == .dark
    host.hoverEnabled = context.environment.floatingHoverActive && context.environment.isEnabled
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: ResultTextHost, context: Context)
    -> CGSize?
  {
    // No text lays out narrower than a point; SwiftUI may still propose zero.
    let width = proposal.width.flatMap { $0.isFinite ? max($0, 1) : nil }
    return ResultTextMeasure.size(of: content.rendered, width: width, maxWidth: maxWidth)
  }
}

/// ``ResultText``'s view: its text view once it is in a window, and the hover region over it.
final class ResultTextHost: NSView {
  var text = NSAttributedString() {
    didSet { if text !== oldValue { textView?.show(text) } }
  }
  var openLink: ((URL) -> Bool)? {
    didSet { textView?.openLink = openLink }
  }
  var dark = false {
    didSet {
      guard dark != oldValue || appearance == nil else { return }
      appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    }
  }
  var hoverEnabled: Bool {
    get { hover.enabled }
    set { hover.enabled = newValue }
  }
  private var textView: ResultTextView?
  private let hover = FloatingHoverRegionView()

  override init(frame: NSRect) {
    super.init(frame: frame)
    hover.pointer = .text
    hover.autoresizingMask = [.width, .height]
    hover.moved = { [weak self] point in self?.pointerMoved(to: point) }
    addSubview(hover)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard window != nil, textView == nil else { return }
    let view = ResultTextView.make()
    view.frame = bounds
    view.autoresizingMask = [.width, .height]
    view.openLink = openLink
    view.show(text)
    addSubview(view, positioned: .below, relativeTo: hover)
    textView = view
  }

  override func layout() {
    super.layout()
    hover.frame = bounds
    textView?.frame = bounds
  }

  /// The pointing hand over a link, the I-beam elsewhere: set before the hover tracking reads
  /// the region's pointer for this move.
  private func pointerMoved(to point: CGPoint) {
    let link = textView.map { $0.hasLink(at: $0.convert(point, from: hover)) } ?? false
    hover.pointer = link ? .action : .text
  }
}
