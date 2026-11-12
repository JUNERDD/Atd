import AICore
import Foundation
import Observation

/// The long screenshot lightbox's side panel (``IslandLightboxPanel``, ``LongScreenshotResultsPanel``):
/// the text commands' result card, once a run started here gave it one. A run the person starts
/// and a result clicked on the image open it; its toggle, ⌥⌘I, its hide button and, as a drawer,
/// Escape or a click outside it hide it (``IslandLightboxPanelState``).
///
/// Docked, the viewer's column and its rail lay out left of it: the layout follows inside the
/// panel's animation (``placePanel()``), and the viewer keeps its zoom and the row at its top as
/// its column changes width (``LongScreenshotViewer/relayout(_:)``). As a drawer it stands over
/// the column between the bars, above the text command row while that shows, and moves nothing.
/// The card's items whose paragraph the viewer shows are marked in view as it scrolls.
extension IslandLongScreenshotLightbox {
  /// A run started here: the panel has a result to show.
  var hasResult: Bool { results.model.card != nil }

  /// Where the panel stands now.
  var panelPlacement: IslandMetrics.LightboxPanelPlacement {
    panel.placement(
      present: hasResult, in: lightbox.workArea,
      between: viewport.layout.betweenBars(textRow: showsTextRow))
  }

  /// The toggle's dot while the panel is hidden: a run is producing, or a result arrived since.
  var panelDot: Bool { results.runs.running != nil || panel.unseen }

  func wirePanel() {
    panel.onChange = { [weak self] in self?.placePanel() }
    results.onArrival = { [weak panel] in panel?.noteArrival() }
    results.onForget = { [weak panel] in panel?.follow() }
    observeViewport()
  }

  /// The toggle and ⌥⌘I, once there is a result to show.
  func togglePanel() {
    guard hasResult else { return }
    panel.toggle()
  }

  /// The viewer's layout follows the panel's place: docked, its column narrows; otherwise it
  /// keeps the whole width.
  private func placePanel() {
    viewer.relayout(
      LongScreenshotLightboxLayout(
        size: lightbox.size, workArea: lightbox.workArea, image: card.source.shot.pointSize,
        dockedPanel: panelPlacement.docked))
  }

  /// The rows the viewer shows changed: the card's items in view follow.
  private func observeViewport() {
    withObservationTracking {
      _ = viewport.visible
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self else { return }
        results.refreshInView()
        observeViewport()
      }
    }
  }
}
