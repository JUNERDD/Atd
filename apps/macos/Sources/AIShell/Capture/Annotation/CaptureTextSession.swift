import AICore
import AppKit

/// What the capture editor keeps for the selection's text between its own state and the
/// annotations: text mode (``CaptureTextMode``), the text commands run on the image
/// (``CaptureTextRuns``), their result card and where it sits, and the passing state the
/// pointer and the keys leave. The editor's extensions own the behaviour
/// (`AnnotationEditor+TextMode.swift`, `+TextRuns.swift`, `+ResultCard.swift`); this only holds
/// it, one per editor, reset whenever the editor hides.
final class CaptureTextSession {
  let mode = CaptureTextMode()
  var runs = CaptureTextRuns()
  let card = CaptureResultCardModel()
  /// The answer under review as the canvases draw it over the image.
  private(set) var preview = CaptureTextReviewPreview()
  /// The card's view in the bars' host, while one shows.
  var cardHost: CaptureResultCardHost?
  /// Whether the editor last told the session it claims the selection's interior (a tool is
  /// chosen or text mode is on).
  var claimed = false
  /// Runs whose pieces wait to land until the gesture or the open text in progress ends.
  var waiting: Set<String> = []
  /// The run whose card's Open in Atd ended the capture: the runner keeps it for the panel.
  var opening: String?
  /// Where the person dragged the card (its top-left, desktop points); nil follows the selection.
  var cardOrigin: CGPoint?
  /// The card's origin when its drag began.
  var cardDragStart: CGPoint?
  /// The side of the selection the card stands on while it follows the selection, which it keeps
  /// as it grows (``CaptureResultPlacement``); a new run's card picks its side afresh.
  var cardSide: CaptureResultPlacement.Side?
  /// Where the card last stood, which its copied capsule takes.
  var cardFrame: CGRect?
  /// ⌥ is held: every translation shows its original.
  var showsOriginals = false
  /// The translation under the pointer, which shows its original: its annotations.
  var peeked: Set<UUID> = []
  /// The press on a step badge a text command drew went down here (no tool chosen): its card
  /// opens on release.
  var badgePress: (run: String, item: Int)?
  /// The card's item whose badge the pointer rests on, which the card lights.
  var imageHot: Int?

  /// Everything back to a fresh editor's.
  func reset() {
    mode.set(on: false)
    runs.removeAll()
    preview = CaptureTextReviewPreview()
    card.reset()
    cardHost?.removeFromSuperview()
    cardHost = nil
    claimed = false
    waiting = []
    opening = nil
    cardOrigin = nil
    cardDragStart = nil
    cardSide = nil
    cardFrame = nil
    showsOriginals = false
    peeked = []
    badgePress = nil
    imageHot = nil
  }
}
