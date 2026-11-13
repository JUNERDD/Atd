import AICore
import AppKit
import Observation
import SwiftUI

/// What the long screenshot's full-screen preview is doing: viewing (a drag moves the image, a
/// click picks a paragraph), working on the text (Select Text: a drag draws a marquee over it), or
/// annotating.
enum LongScreenshotLightboxMode: Equatable {
  case view, text, annotate
}

/// The long screenshot card's lightbox content (``IslandLightboxContent``, the result preview's
/// direction A): the whole image in the viewer (``LongScreenshotViewer``) left of its overview
/// rail (``LongScreenshotRail``), between a top bar (title, pages, zoom, Restore, the side panel's
/// toggle once a text command ran, back to the card) and a bottom bar (key hints, Select Text,
/// Cover Sensitive Info, Annotate, Copy, Attach), all on the card's own model, so a trim, a
/// mosaic, an annotation or a footer's feedback shows in both at once.
///
/// Its ``mode``:
/// - View: a click picks a paragraph of the recognized text (``LongScreenshotTextModel``) and,
///   with picks, the text command row docks above the bottom bar.
/// - Text (Select Text): the row stays, a drag draws a marquee over the text, Space held pans,
///   and Escape steps back (``IslandLongScreenshotLightbox+Keys``). Text commands run from the row
///   and land on the image (``LongScreenshotTextResults``), their result in the side panel
///   (``IslandLongScreenshotLightbox+Panel``).
/// - Annotate: the image is annotated in place with the screenshot editor's tools
///   (``LongScreenshotAnnotator``): its tool bar takes the middle of the top, the trim bars and
///   the page hover go, and the annotation canvas takes the keyboard. It opens there when the
///   card's Annotate opened it.
///
/// Motion: until the image has landed, and from the moment closing starts, a ghost of the card's
/// preview image stands for the image at the whole image's frame
/// (``IslandLongScreenshotLightboxGhost``), so it grows from the card and goes back into it;
/// the live viewer shows only in between. Where nothing moves (Reduce Motion, no card media to
/// grow from) the viewer itself fades in and out.
@Observable
final class IslandLongScreenshotLightbox: IslandLightboxContent {
  let card: IslandLongScreenshotCardModel
  let labels: IslandLongScreenshotLabels
  let lightbox: IslandLightboxModel
  /// Where it opened: `y` image points about a third down the view, or the top.
  let start: CGFloat?
  let annotator: LongScreenshotAnnotator
  let viewport: LongScreenshotViewport
  let viewer: LongScreenshotViewer
  let text: LongScreenshotTextModel
  let results: LongScreenshotTextResults
  let menus: LongScreenshotTextMenus
  let services: LongScreenshotTextServices
  /// Whether the side panel with the result shows, once a run gave it one.
  let panel: IslandLightboxPanelState
  /// The image grows from the card's media and back into it; otherwise the viewer fades.
  let moves: Bool
  private(set) var mode: LongScreenshotLightboxMode
  /// Closing has started: the ghost stands for the image again.
  private(set) var closing = false
  /// One of the bars' buttons has the keyboard focus (Full Keyboard Access): Space and the
  /// arrows stay with it.
  @ObservationIgnored var controlFocused = false
  /// ⌥ is held outside annotate mode: the image shows without its replacements.
  @ObservationIgnored var peeking = false

  init(
    card: IslandLongScreenshotCardModel, labels: IslandLongScreenshotLabels,
    lightbox: IslandLightboxModel, at start: CGFloat?, annotate: Bool,
    services: LongScreenshotTextServices
  ) {
    self.card = card
    self.labels = labels
    self.lightbox = lightbox
    self.start = start
    self.services = services
    let layout = LongScreenshotLightboxLayout(
      size: lightbox.size, workArea: lightbox.workArea, image: card.source.shot.pointSize)
    viewport = LongScreenshotViewport(layout: layout, start: start, top: card.state.kept.top)
    annotator = LongScreenshotAnnotator(card: card)
    text = LongScreenshotTextModel(layout: card.source.paragraphs, kept: card.state.kept)
    viewer = LongScreenshotViewer(
      card: card, viewport: viewport, labels: labels, canvas: annotator.canvas, text: text)
    results = LongScreenshotTextResults(
      card: card, annotator: annotator, text: text, services: services)
    menus = LongScreenshotTextMenus(services: services)
    panel = IslandLightboxPanelState(kind: .longScreenshot, reduceMotion: lightbox.reduceMotion)
    moves = lightbox.origin != nil && !lightbox.reduceMotion
    mode = annotate ? .annotate : .view
    annotator.active = annotate
    // The arrows scroll until a trim bar here is pressed.
    card.focusedHandle = nil
    wire()
    if moves {
      viewer.setShown(false)
    } else {
      viewer.container.alphaValue = 0
    }
  }

  private func wire() {
    viewer.onBackdrop = { [weak self] in self?.backdropClicked() }
    viewer.onPick = { [weak self] point, modifiers in self?.picked(at: point, modifiers) }
    viewer.opensCard = { [weak results] point in results?.opensCard(at: point) ?? false }
    text.onChange = { [weak viewer] in viewer?.picks.refresh() }
    results.visibleRows = { [weak viewport] in viewport?.visible ?? 0...0 }
    results.reveal = { [weak self] box in self?.reveal(box) }
    results.onOpen = { [weak lightbox] in lightbox?.close() }
    menus.onLaunch = { [weak self] launch in self?.run(launch) }
    wirePanel()
    observeCard()
  }

  /// The card's kept range or annotations changed: what can be picked follows.
  private func observeCard() {
    withObservationTracking {
      _ = card.state.kept
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self else { return }
        text.refresh(kept: card.state.kept)
        observeCard()
      }
    }
  }

  var view: AnyView { AnyView(IslandLongScreenshotLightboxView(content: self)) }

  /// The live viewer shows and takes keys: the image has landed (it has nowhere to land from
  /// where nothing moves) and closing has not started.
  var live: Bool {
    guard lightbox.phase == .shown, !closing else { return false }
    return !moves || lightbox.chromeShown
  }

  var annotating: Bool { mode == .annotate }

  /// The text command row shows: always in text mode, and in view mode while text is picked.
  var showsTextRow: Bool { mode == .text || (mode == .view && !text.picks.isEmpty) }

  /// The viewer became live: annotate mode's canvas takes the keyboard, once it is in the
  /// window.
  func landed() {
    DispatchQueue.main.async { [weak self] in
      guard let self, annotating, !closing, let window = annotator.canvas.window else { return }
      window.makeFirstResponder(annotator.canvas)
    }
  }

  /// Enters `next`: annotate mode's canvas takes the pointer and the keys, text mode's text
  /// flashes once; a drag in progress ends either way, and what waited to land lands.
  func setMode(_ next: LongScreenshotLightboxMode) {
    guard mode != next else { return }
    let previous = mode
    mode = next
    viewer.endTrim()
    menus.close()
    setPeeking(false)
    annotator.active = next == .annotate
    if previous == .annotate {
      annotator.finish()
      if let window = annotator.canvas.window, window.firstResponder === annotator.canvas {
        window.makeFirstResponder(nil)
      }
    }
    switch next {
    case .annotate:
      viewer.stopPan()
      card.hoverPreview(at: nil)
      landed()
    case .text:
      text.flash()
    case .view:
      break
    }
    results.landPending()
  }

  /// Annotate, Done, Escape.
  func setAnnotating(_ on: Bool) { setMode(on ? .annotate : .view) }

  /// A click on the image (not a drag): a run's step badge opens its card in the side panel with
  /// the item lit; anything else picks the paragraph under it, and in text mode a plain click on
  /// the result of a run with versions opens that run's card too. The panel shows what opened.
  private func picked(at point: CGPoint, _ modifiers: NSEvent.ModifierFlags) {
    guard mode != .annotate else { return }
    let plain = modifiers.isDisjoint(with: [.command, .shift])
    if plain, results.openBadge(at: point) { return panel.open() }
    text.click(at: point, modifiers: modifiers)
    if plain, mode == .text, results.reopen(at: point) { panel.open() }
  }

  /// A click on the backdrop steps back: the picks clear first, then text mode ends, then the
  /// lightbox closes.
  private func backdropClicked() {
    if text.clear() { return }
    if mode == .text { return setMode(.view) }
    lightbox.close()
  }

  /// Shows paragraph box `box` (image points) about a third down the view, unless it shows.
  private func reveal(_ box: CGRect) {
    let visible = viewport.visible
    guard box.minY < visible.lowerBound || box.maxY > visible.upperBound else { return }
    viewer.show(y: max(box.minY - 48, 0), animated: true)
  }

  /// Closing: open edits end, a drag lets go, the page hover clears, every run closes, and the
  /// ghost takes the image's place where it stands (or the viewer fades where nothing moves).
  func willClose() {
    annotator.finish()
    viewer.endTrim()
    viewer.stopPan()
    viewer.cancelMarquee()
    menus.close()
    setPeeking(false)
    card.hoverPreview(at: nil)
    results.release()
    closing = true
    if moves {
      viewer.setShown(false)
    } else {
      viewer.fade(to: 0)
    }
  }
}
