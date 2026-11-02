import AICore
import Observation
import SwiftUI

/// What the command island shows.
enum IslandContent: Equatable {
  /// A command shortcut is down: the command's name and the charge toward its options card.
  case press(command: String)
  /// The run is going, with the values it runs with when it has options to change.
  case working(command: String, summary: String?)
  /// The options card (``IslandModel/card``) of the named command.
  case choose(command: String)
  case writing
  case done
  case notice(message: String)
  /// The answer card (``IslandAnswerCard``): a run's answer that could not be written.
  case answer(command: String, answer: String, note: String?)
  /// The review card (``IslandReviewCard``, its draft in ``IslandModel/review``): an answer that
  /// waits for review, with its original, changes, versions and options.
  case review(command: String, answer: String, note: String?, review: CommandProgressState.Review)
  /// The answer card's answer went to the clipboard.
  case copied
  /// The compose card (``IslandComposeCard``, its draft in ``IslandModel/compose``) of the named
  /// command, launched with nothing selected; `attach` offers a screenshot or files.
  case compose(command: String, attach: Bool)

  /// Content of the same kind changes in place; another kind replaces it through a morph.
  enum Kind {
    case press, working, choose, writing, done, notice, answer, review, copied, compose

    /// A card (the options card, the answer card, the review card, the compose card), with the
    /// card's corner rather than a capsule's.
    var isCard: Bool { [.choose, .answer, .review, .compose].contains(self) }
  }

  var kind: Kind {
    switch self {
    case .press: .press
    case .working: .working
    case .choose: .choose
    case .writing: .writing
    case .done: .done
    case .notice: .notice
    case .answer: .answer
    case .review: .review
    case .copied: .copied
    case .compose: .compose
    }
  }
}

/// One content mounted in the island: laid out where its shape rests and following the shape as
/// drawn, arriving and leaving on its own presence. A content stays mounted while it leaves, so
/// the next one arrives into the same shape.
struct IslandLayer: Identifiable, Equatable {
  let id: Int
  var content: IslandContent
  /// Where the content rests in the canvas (y down): its shape's frame at rest.
  var rest: CGRect
  var presence: MiniPanelPresence
  /// How wide a capsule's texts may grow (``IslandMetrics/CapsuleLimits``).
  var limits = IslandMetrics.CapsuleLimits()
  /// The write offer this layer was measured with. A departing answer keeps its footer even
  /// after the focus watch stops or the next card gets a different offer.
  var answerOffer: AnswerWriteOffer?
  /// The card a leaving options card shows, frozen as it left, so it never draws the page that
  /// replaces it while it fades.
  var card: OptionsCard?
  /// The content scales with its shape as it follows it; off while direct edits resize it in
  /// place (``IslandChoreography/inPlace``), on again once it leaves or reverses its exit.
  var scales = true
}

/// The island's glass: where its shape rests in the canvas (y down) with its corner, and the
/// animation it moves there on (its height and corner on the thickness spring, its width on the
/// length's: ``MiniPanelShapeAxis/vertical``); nil for a jump.
struct IslandShape: Equatable {
  var frame = CGRect.zero
  var corner = 0.0
  var animation: Animation?

  /// The shape as the outline, the clip and following content take it.
  var glass: MiniPanelGlassRect { MiniPanelGlassRect(frame, corner: corner, in: .zero) }

  /// The shape at `scale` of its size about the middle of its bottom edge, `drop` points lower
  /// (y down), on `animation`: where the entrance starts and the exit ends. Drawn into the shape
  /// rather than applied as a transform, since a glass view's scale is dropped in a glass
  /// container (``MiniPanelBodyShape/drawn(_:)``).
  func scaled(_ scale: Double, drop: Double = 0, animation: Animation? = nil) -> IslandShape {
    let width = frame.width * scale
    let height = frame.height * scale
    return IslandShape(
      frame: CGRect(
        x: frame.midX - width / 2, y: frame.maxY - height + drop, width: width, height: height),
      corner: corner * scale, animation: animation)
  }
}

/// What the island's controls call back with.
enum IslandAction: Equatable {
  /// The working capsule's × (or Escape, which the progress controller holds).
  case cancel
  /// The notice's Open, and the answer and review cards'.
  case open
  /// The notice's × and the answer and review cards' (or Escape on the answer card).
  case dismiss
  /// The answer and review cards' Copy (or ⌘C on them).
  case copy
  /// The working capsule's values chip.
  case change
  /// The answer and review cards' Insert (``AnswerWriteOffer/insert``) or Replace (`selection`),
  /// or their keys.
  case write(TextWriteParams.Mode)
}

/// What the compose card's field and controls do.
enum IslandComposeEvent: Equatable {
  /// The field's text changed.
  case text(String)
  /// The chip at this index was removed.
  case remove(Int)
  /// The attach control was pressed: its menu opens against the control's frame, in the
  /// window's content coordinates (y down).
  case attach(CGRect)
  /// The Screen Recording note's Open System Settings.
  case openScreenRecordingSettings
  case run
  case open
}

/// What the options card's pointer and filter field do.
enum IslandCardEvent: Equatable {
  case hover(Int)
  case click(Int)
  case run
  case filter(String)
}

/// The grip's drag, in global coordinates.
enum IslandDrag: Equatable {
  case began
  case moved
  case ended
  /// A double-click puts the island back at home.
  case reset
}

/// The island's copy in the shell language, built again when it changes.
struct IslandLabels: Equatable {
  var cancel = ""
  var dismiss = ""
  var open = ""
  var openTooltip = ""
  var writing = ""
  var done = ""
  var change = ""
  var holdHint = ""
  var move = ""
  /// The working hint with ``GlassHUDPieces/keysMarker`` where its keys go.
  var escapeHint = ""
  var run = ""
  var edit = ""
  var filter = ""
  var noMatch = ""
  var keyPick = ""
  var keyBack = ""
  var keyClose = ""
  var keyMove = ""
  var keyChange = ""
  var keyOpen = ""
  var copy = ""
  var copied = ""
  var close = ""
  var openInAtd = ""
  var openInAtdTooltip = ""
  var insert = ""
  var replace = ""
  var composeNote = ""
  var composeNoteAttach = ""
  var composePlaceholder = ""
  var composeAttach = ""
  var composeLimit = ""
  var composeScreenRecording = ""
  var composeScrollLeft = ""
  var composeScrollRight = ""
  var composeOpenSystemSettings = ""
  /// The review card's copy, and the options sheet's Done.
  var review = IslandReviewLabels()

  static func current() -> IslandLabels {
    let strings = ShellStrings.shared
    return IslandLabels(
      cancel: strings.text(.commandProgressCancel), dismiss: strings.text(.commandProgressDismiss),
      open: strings.text(.commandProgressOpen),
      openTooltip: strings.text(.commandProgressOpenTooltip),
      writing: strings.text(.commandProgressWriting), done: strings.text(.commandProgressDone),
      change: strings.text(.commandOptionsChange), holdHint: strings.text(.commandOptionsHoldHint),
      move: strings.text(.captureToolbarMove),
      escapeHint: strings.text(.commandProgressHint, GlassHUDPieces.keysMarker),
      run: strings.text(.commandOptionsRun), edit: strings.text(.commandOptionsEdit),
      filter: strings.text(.commandOptionsFilter), noMatch: strings.text(.commandOptionsNoMatch),
      keyPick: strings.text(.commandOptionsKeyPick), keyBack: strings.text(.commandOptionsKeyBack),
      keyClose: strings.text(.commandOptionsKeyClose),
      keyMove: strings.text(.commandOptionsKeyMove),
      keyChange: strings.text(.commandOptionsKeyChange),
      keyOpen: strings.text(.commandOptionsKeyOpen),
      copy: strings.text(.commandProgressCopy), copied: strings.text(.commandProgressCopied),
      close: strings.text(.commandProgressClose),
      openInAtd: strings.text(.commandProgressOpenInAtd),
      openInAtdTooltip: strings.text(.commandProgressOpenInAtdTooltip),
      insert: strings.text(.commandProgressInsert), replace: strings.text(.commandProgressReplace),
      composeNote: strings.text(.commandComposeNote),
      composeNoteAttach: strings.text(.commandComposeNoteAttach),
      composePlaceholder: strings.text(.commandComposePlaceholder),
      composeAttach: strings.text(.commandComposeAttach),
      composeLimit: strings.text(.commandComposeLimit),
      composeScreenRecording: strings.text(.commandComposeScreenRecording),
      composeScrollLeft: strings.text(.commandComposeScrollLeft),
      composeScrollRight: strings.text(.commandComposeScrollRight),
      composeOpenSystemSettings: strings.text(.commandComposeOpenSystemSettings),
      review: .current())
  }

  /// What VoiceOver reads for a working run of `command`.
  func working(_ command: String) -> String {
    ShellStrings.shared.text(.commandProgressWorking, command)
  }

  /// The options card's name for VoiceOver.
  func options(_ command: String) -> String {
    ShellStrings.shared.text(.commandOptionsMenu, command)
  }

  /// The answer card's name for VoiceOver.
  func answer(_ command: String) -> String {
    ShellStrings.shared.text(.commandProgressAnswer, command)
  }

  /// Insert's tooltip and VoiceOver name, naming the app the field is in.
  func insert(in app: String) -> String {
    ShellStrings.shared.text(.commandProgressInsertIn, app)
  }

  /// Insert's tooltip and VoiceOver name while the field has a selection, which it writes after.
  func insertAfter(in app: String) -> String {
    ShellStrings.shared.text(.commandProgressInsertAfterIn, app)
  }

  /// Replace's tooltip and VoiceOver name, naming the app the field is in.
  func replace(in app: String) -> String {
    ShellStrings.shared.text(.commandProgressReplaceIn, app)
  }

  /// The compose card's name for VoiceOver.
  func compose(_ command: String) -> String {
    ShellStrings.shared.text(.commandComposeCard, command)
  }

  /// An attachment chip's remove button, for VoiceOver and its tooltip.
  func remove(_ name: String) -> String {
    ShellStrings.shared.text(.commandComposeRemove, name)
  }
}

/// The command island as drawn: its one glass shape, the contents riding in it, and the options
/// card's state. ``IslandController`` writes it; SwiftUI interpolates every change on the
/// animation it carries, so nothing is written while anything moves.
@Observable
final class IslandModel {
  /// Bumped by every entrance: the view tree is built anew for it, so nothing drawn or still
  /// animating from an earlier island carries over.
  var appearance = 0
  var shape = IslandShape()
  var layers: [IslandLayer] = []
  /// The options card the active `choose` content shows.
  var card: OptionsCard?
  /// What the answer card offers to write where the person's focus is now
  /// (``AnswerFocusWatch``); nil while that focus cannot take text.
  var answerOffer: AnswerWriteOffer?
  /// The compose card's text and attachments, kept while the card shows for one target.
  var compose = ComposeDraft()
  /// What the review card staged, kept while it shows for one target.
  var review = ReviewDraft()
  /// The review card's chip the keyboard highlights, as an index into its row
  /// (``ReviewChip/row(_:adjustments:)``); nil while the keys go to its field.
  var reviewChip: Int?
  /// The options card is the review card's options sheet: its button is Done, which stages its
  /// values for the next version instead of running.
  var cardStages = false
  /// A card has the keyboard: the options card's filter field or the compose card's text field
  /// takes focus.
  var cardIsKey = false
  /// Reduce Motion, followed live: no bounce, and content keeps its own size.
  var reduceMotion = false
  var labels = IslandLabels()

  @ObservationIgnored var act: (IslandAction) -> Void = { _ in }
  @ObservationIgnored var cardEvent: (IslandCardEvent) -> Void = { _ in }
  @ObservationIgnored var composeEvent: (IslandComposeEvent) -> Void = { _ in }
  @ObservationIgnored var reviewEvent: (IslandReviewEvent) -> Void = { _ in }
  @ObservationIgnored var drag: (IslandDrag) -> Void = { _ in }
}
