import AICore
import AppKit
import Observation
import SwiftUI

/// What the annotator's bars show: whether they show at all (annotate mode), the tool bar's size
/// and, while something is styled, the style bar's.
@Observable
final class LongScreenshotAnnotatorBarsModel {
  var shown = false
  private(set) var toolbar = CGSize.zero
  private(set) var styleBar: CGSize?

  /// Takes the bars' fitting sizes, writing only what changed.
  func update(toolbar: CGSize, styleBar: CGSize?) {
    if self.toolbar != toolbar { self.toolbar = toolbar }
    if self.styleBar != styleBar { self.styleBar = styleBar }
  }
}

/// The annotator's bars for the lightbox's chrome (``LongScreenshotAnnotator/bars``): the
/// editor's tool bar and, while something is styled, its style bar beside it, each at its own
/// fitting size with the editor's gap between its two rows. Both stay the editor's AppKit bars
/// on its glass, which the annotator pins dark like the lightbox's own bars
/// (``AnnotationToolbar/pinDark()``).
struct LongScreenshotAnnotatorBars: View {
  let model: LongScreenshotAnnotatorBarsModel
  let toolbar: AnnotationToolbar
  let styleBar: AnnotationStyleBar

  /// The editor's gap between its tool bar and its style bar (``AnnotationToolbarLayout``).
  static let gap: CGFloat = 6

  var body: some View {
    HStack(spacing: Self.gap) {
      if model.shown {
        LongScreenshotAnnotatorBar(bar: toolbar)
          .frame(width: model.toolbar.width, height: model.toolbar.height)
        if let size = model.styleBar {
          LongScreenshotAnnotatorBar(bar: styleBar)
            .frame(width: size.width, height: size.height)
        }
      }
    }
  }
}

/// One AppKit bar in SwiftUI: a plain view holding it at its whole size.
private struct LongScreenshotAnnotatorBar: NSViewRepresentable {
  let bar: NSView

  func makeNSView(context: Context) -> NSView {
    let host = LongScreenshotAnnotatorBarHost()
    host.addSubview(bar)
    return host
  }

  func updateNSView(_ host: NSView, context: Context) {
    if bar.superview !== host { host.addSubview(bar) }
    host.needsLayout = true
  }
}

/// Lays its bar out over its whole bounds.
private final class LongScreenshotAnnotatorBarHost: NSView {
  override func layout() {
    super.layout()
    for view in subviews { view.frame = bounds }
  }
}

/// The bars' buttons follow the pointer through the lightbox window's own clock
/// (``FloatingHoverHost``), as the selection toolbar's do: an inactive app's tracking areas and
/// cursor rects, which the buttons use over the capture overlay, report late or not at all, and
/// the lightbox never activates Atd. Each button gets a region over it that sets its hover wash
/// and its cursor (``PointerRole/init(button:)``); the buttons stop following the pointer
/// themselves.
final class LongScreenshotAnnotatorHover {
  private var regions: [(region: FloatingHoverRegionView, button: AnnotationToolbarButton)] = []

  init(bars: [NSView]) {
    for button in bars.flatMap(Self.buttons(in:)) {
      button.followsPointer = false
      let region = FloatingHoverRegionView(frame: button.bounds)
      region.autoresizingMask = [.width, .height]
      region.changed = { [weak button] in button?.isHovered = $0 }
      button.addSubview(region)
      regions.append((region, button))
    }
    refresh()
  }

  /// Each region's cursor as its button's enabled state now has it (undo greys out).
  func refresh() {
    for (region, button) in regions { region.pointer = PointerRole(button: button) }
  }

  private static func buttons(in view: NSView) -> [AnnotationToolbarButton] {
    view.subviews.flatMap { subview in
      (subview as? AnnotationToolbarButton).map { [$0] } ?? buttons(in: subview)
    }
  }
}
