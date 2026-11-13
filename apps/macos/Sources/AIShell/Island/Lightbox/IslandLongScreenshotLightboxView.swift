import AICore
import AppKit
import SwiftUI

/// The long screenshot lightbox's view (``IslandLongScreenshotLightbox``) in the lightbox's whole
/// size: the viewer in its column, the motion's ghost over it, then the chrome: the overview rail
/// right of the column, the bars above and below it and the side panel with the text commands'
/// result (``LongScreenshotResultsPanel``), docked beside the rail or a drawer over the column's
/// right side between the bars, which fade in once the image has landed and go first when
/// closing. Under a drawer a click on the image or the scrim closes it
/// (``IslandLightboxDrawerCatcher``).
struct IslandLongScreenshotLightboxView: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let lightbox = content.lightbox
    let column = content.viewport.layout.column
    let placement = content.panelPlacement
    ZStack(alignment: .topLeading) {
      LongScreenshotViewerLayer(content: content)
        .frame(width: column.width, height: column.height)
        .padding(.leading, column.minX)
        .padding(.top, column.minY)
      if content.moves { IslandLongScreenshotLightboxGhost(content: content) }
      Group {
        if placement.isDrawer { IslandLightboxDrawerCatcher { content.panel.hide() } }
        LongScreenshotRail(content: content)
        IslandLongScreenshotLightboxChrome(content: content)
          .frame(width: column.width, height: column.height)
          .padding(.leading, column.minX)
          .padding(.top, column.minY)
        IslandLightboxPanelSlot(placement: placement) {
          LongScreenshotResultsPanel(content: content)
        }
      }
      .opacity(lightbox.chromeOpacity)
      .allowsHitTesting(lightbox.chromeShown)
      // A trim bar's drag keeps its cursor: the chrome's hover sleeps meanwhile.
      .environment(
        \.floatingHoverActive, lightbox.phase == .shown && !content.viewport.trimming)
    }
    .frame(width: lightbox.size.width, height: lightbox.size.height, alignment: .topLeading)
    .onPreferenceChange(IslandControlFocus.self) { content.controlFocused = $0 }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: content.labels.preview))
  }
}

/// The viewer as the lightbox shows it: it reads what the viewer's marks show from the card (the
/// kept range with what is on the image, the pages, the hovered page, the focused bar), the mode
/// and whether the viewer is live, so the viewer follows them (``LongScreenshotViewerHost``).
private struct LongScreenshotViewerLayer: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let card = content.card
    LongScreenshotViewerHost(
      viewer: content.viewer,
      marks: LongScreenshotViewerHost.Marks(
        kept: card.state.kept, pages: card.pages, hovered: card.hoveredPage,
        focused: card.focusedHandle, mode: content.mode),
      live: content.live, opacity: content.moves ? nil : content.lightbox.mediaOpacity
    ) { content.landed() }
  }
}

/// Hosts the viewer's AppKit view (``LongScreenshotViewer/container``), which the content owns
/// for the lightbox's life, and passes it what changed.
private struct LongScreenshotViewerHost: NSViewRepresentable {
  /// What the viewer's marks show.
  struct Marks: Equatable {
    let kept: LongScreenshotKept
    let pages: [LongScreenshotCardPage]
    let hovered: Int?
    let focused: LongScreenshotCardState.Edge?
    let mode: LongScreenshotLightboxMode
  }

  let viewer: LongScreenshotViewer
  let marks: Marks
  let live: Bool
  /// The viewer's opacity where it fades instead of the ghost moving; nil where the ghost moves
  /// and the viewer shows only while ``live``.
  let opacity: Double?
  /// The viewer became live.
  let landed: () -> Void

  final class Coordinator {
    var marks: Marks?
    var live = false
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> LongScreenshotViewerContainer { viewer.container }

  func updateNSView(_ view: LongScreenshotViewerContainer, context: Context) {
    if context.coordinator.marks != marks {
      context.coordinator.marks = marks
      viewer.refresh(mode: marks.mode)
    }
    if let opacity {
      viewer.fade(to: opacity)
    } else {
      viewer.setShown(live)
    }
    guard live != context.coordinator.live else { return }
    context.coordinator.live = live
    if live { landed() }
  }
}

/// The motion's stand-in for the image (``IslandLightboxModel/mediaFrame(_:)``): the card's
/// preview image, shaded outside the kept range, at the whole image's frame, which grows from the
/// card's media while the lightbox opens and goes back into it while it closes. It shows only
/// while the live viewer does not, and switches at once, so the two never show together; while
/// the viewer shows it follows the image's frame unseen, so closing starts where the image is.
private struct IslandLongScreenshotLightboxGhost: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let lightbox = content.lightbox
    let frame = lightbox.mediaFrame(content.viewport.imageFrame)
    let state = content.card.state
    let height = max(state.height, 1)
    Group {
      if let image = content.card.displayThumbnail {
        Image(decorative: image, scale: 1).resizable().interpolation(.high)
      } else {
        Color.clear
      }
    }
    // Plain fills, never a canvas: the frame can be tens of thousands of points tall.
    .overlay(alignment: .top) {
      Color.black.opacity(0.55).frame(height: frame.height * state.kept.top / height)
    }
    .overlay(alignment: .bottom) {
      Color.black.opacity(0.55)
        .frame(height: frame.height * max(height - state.kept.bottom, 0) / height)
    }
    .animation(nil) { $0.opacity(content.live ? 0 : 1) }
    .frame(width: frame.width, height: frame.height)
    .position(x: frame.midX, y: frame.midY)
    .opacity(lightbox.mediaOpacity)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
