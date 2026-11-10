import AICore
import AppKit
import Carbon.HIToolbox
import Observation
import SwiftUI

/// The long screenshot card's lightbox content (``IslandLightboxContent``, the result preview's
/// direction A): the whole image in the viewer (``LongScreenshotViewer``) left of its overview
/// rail (``LongScreenshotRail``), between a top bar (title, pages, zoom, Restore, back to the
/// card) and a bottom bar (key hints, the cover, Annotate, Copy, Attach), all on the card's own
/// model, so a trim, a cover, an annotation or a footer's feedback shows in both at once.
///
/// Annotate mode (``annotating``) annotates the image in place with the screenshot editor's
/// tools (``LongScreenshotAnnotator``): its tool bar takes the middle of the top, the trim bars
/// and the page hover go, and the annotation canvas takes the keyboard. It opens there when the
/// card's Annotate opened it.
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
  /// It opened in annotate mode.
  let annotate: Bool
  let annotator: LongScreenshotAnnotator
  let viewport: LongScreenshotViewport
  let viewer: LongScreenshotViewer
  /// The image grows from the card's media and back into it; otherwise the viewer fades.
  let moves: Bool
  /// Annotate mode.
  private(set) var annotating: Bool
  /// Closing has started: the ghost stands for the image again.
  private(set) var closing = false
  /// One of the bars' buttons has the keyboard focus (Full Keyboard Access): Space and the
  /// arrows stay with it.
  @ObservationIgnored var controlFocused = false

  init(
    card: IslandLongScreenshotCardModel, labels: IslandLongScreenshotLabels,
    lightbox: IslandLightboxModel, at start: CGFloat?, annotate: Bool
  ) {
    self.card = card
    self.labels = labels
    self.lightbox = lightbox
    self.start = start
    self.annotate = annotate
    let layout = LongScreenshotLightboxLayout(
      size: lightbox.size, workArea: lightbox.workArea, image: card.source.shot.pointSize)
    viewport = LongScreenshotViewport(layout: layout, start: start, top: card.state.kept.top)
    annotator = LongScreenshotAnnotator(card: card)
    viewer = LongScreenshotViewer(
      card: card, viewport: viewport, labels: labels, canvas: annotator.canvas)
    moves = lightbox.origin != nil && !lightbox.reduceMotion
    annotating = annotate
    annotator.active = annotate
    // The arrows scroll until a trim bar here is pressed.
    card.focusedHandle = nil
    viewer.onBackdrop = { [weak lightbox] in lightbox?.close() }
    if moves {
      viewer.setShown(false)
    } else {
      viewer.container.alphaValue = 0
    }
  }

  var view: AnyView { AnyView(IslandLongScreenshotLightboxView(content: self)) }

  /// The live viewer shows and takes keys: the image has landed (it has nowhere to land from
  /// where nothing moves) and closing has not started.
  var live: Bool {
    guard lightbox.phase == .shown, !closing else { return false }
    return !moves || lightbox.chromeShown
  }

  /// The viewer became live: annotate mode's canvas takes the keyboard, once it is in the
  /// window.
  func landed() {
    DispatchQueue.main.async { [weak self] in
      guard let self, annotating, !closing, let window = annotator.canvas.window else { return }
      window.makeFirstResponder(annotator.canvas)
    }
  }

  /// Enters or leaves annotate mode (Annotate, Done, Escape).
  func setAnnotating(_ on: Bool) {
    guard annotating != on else { return }
    annotating = on
    annotator.active = on
    if on {
      viewer.endTrim()
      viewer.stopPan()
      card.hoverPreview(at: nil)
      landed()
    } else {
      annotator.finish()
      if let window = annotator.canvas.window, window.firstResponder === annotator.canvas {
        window.makeFirstResponder(nil)
      }
    }
  }

  // MARK: Keys

  /// View mode: ↑ ↓ scroll by 90 pt (or nudge a pressed trim bar, ⇧ by 100 pt), Page Up and
  /// Page Down go a page, + = − zoom by a step, 0 switches Fit ⇄ 100%, Space closes. Annotate
  /// mode: Escape steps back in the editor, then leaves annotate mode; every other key goes on to
  /// the canvas. Escape not taken closes the lightbox.
  func key(_ event: NSEvent) -> Bool {
    guard live else { return false }
    let code = Int(event.keyCode)
    if annotating {
      guard code == kVK_Escape else { return false }
      if !annotator.stepBack() { setAnnotating(false) }
      return true
    }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard modifiers.isEmpty || modifiers == .shift else { return false }
    let plain = modifiers.isEmpty
    switch code {
    case kVK_UpArrow, kVK_DownArrow:
      guard !controlFocused else { return false }
      let down = code == kVK_DownArrow
      if card.nudge(down: down, shift: !plain) { return true }
      viewer.scroll(by: (down ? 1 : -1) * LongScreenshotLightboxLayout.arrowScroll)
    case kVK_PageUp where plain, kVK_PageDown where plain:
      viewer.showPage(code == kVK_PageDown ? 1 : -1)
    case kVK_Space where plain:
      guard !controlFocused else { return false }
      lightbox.close()
    default:
      switch event.charactersIgnoringModifiers {
      case "+", "=": viewer.zoomIn()
      case "-", "−": viewer.zoomOut()
      case "0": viewer.toggleFit()
      default: return false
      }
    }
    return true
  }

  /// ⌘C copies the kept image, ⌘↩ attaches it, as the card's footer does; never while text is
  /// being typed into an annotation.
  func keyEquivalent(_ event: NSEvent) -> Bool {
    guard live, !annotator.isEditingText,
      let key = IslandShellFooterKey(event, field: nil)
    else { return false }
    send(key)
    return true
  }

  /// Copy or Attach, on the range kept now with its cover and annotations.
  func send(_ key: IslandShellFooterKey) {
    annotator.finish()
    switch key {
    case .copy: card.onEvent(.copy(card.state.kept))
    case .attach: card.onEvent(.attach(card.state.kept))
    }
  }

  /// Closing: open edits end, a drag lets go, the page hover clears, and the ghost takes the
  /// image's place where it stands (or the viewer fades where nothing moves).
  func willClose() {
    annotator.finish()
    viewer.endTrim()
    viewer.stopPan()
    card.hoverPreview(at: nil)
    closing = true
    if moves {
      viewer.setShown(false)
    } else {
      viewer.fade(to: 0)
    }
  }
}
