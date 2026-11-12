import AICore
import SwiftUI

/// The result card's footer row (``IslandFooterRow``): its key hints, then its actions, which rest
/// while the run produces, in either container of the card's content.
///
/// The floating card (`feedback` nil) collapses into the copied capsule after a copy, so its
/// actions are plain buttons; where the row does not fit, the secondary ones compact to glyphs and
/// the primary one keeps its label. A container that stays (the lightbox's side panel) passes how
/// each action went: every action then reports on its own button (``IslandFeedbackButton``), its
/// message taking the room it needs while the row compacts secondary actions first and keeps the
/// primary one's label, as the floating cards' action feedback does. Where Escape does not discard
/// a result waiting for review there (`offersDiscard`), Discard stands before Apply and does what
/// that Escape did.
struct CaptureResultFooter: View {
  let model: CaptureResultCardModel
  let card: CaptureResultCard
  /// The hints it shows: the card's, or those its container leaves to it.
  let hints: [CaptureResultCard.Hint]
  /// How each action went, for a container whose card stays; nil on the floating card.
  var feedback: [CaptureResultCard.Action: IslandRecording.CardFeedback]?
  /// Discard shows before Apply while the card waits for it.
  var offersDiscard = false

  private var labels: CaptureResultLabels { model.labels }

  var body: some View {
    IslandFooterRow(hints: { hintsRow(compact: $0) }, actions: { actions(compact: $0) })
  }

  private func hintsRow(compact: Bool) -> some View {
    HStack(spacing: 10) {
      ForEach(hints, id: \.self) { hint in
        let (keys, label) = labels.hint(hint)
        if compact {
          IslandKeycap(symbol: keys)
            .help(label)
            .accessibilityLabel(Text(verbatim: keys + " " + label))
        } else {
          IslandKeyHint(keys: keys, label: label)
        }
      }
    }
  }

  private func actions(compact: Bool) -> some View {
    HStack(spacing: IslandMetrics.gap) {
      ForEach(card.actions, id: \.self) { action in
        if offersDiscard, action == .apply { discard(compact: compact) }
        button(action, compact: compact)
      }
    }
    .disabled(card.busy)
    .opacity(card.busy ? 0.38 : 1)
    .fixedSize()
  }

  @ViewBuilder private func button(_ action: CaptureResultCard.Action, compact: Bool) -> some View {
    let notes = Self.listsNotes(card)
    let keys = CaptureResultLabels.keys(action, primary: card.primary)
    if let feedback {
      IslandFeedbackButton(
        title: labels.title(action), glyph: labels.glyph(action),
        workingLabel: labels.island.recording.actionWorking,
        tooltip: labels.description(action, insertApp: model.insertApp, notes: notes), keys: keys,
        primary: action == card.primary, compact: compact, feedback: feedback[action]
      ) { model.perform(action) }
    } else {
      let tooltip = labels.tooltip(action, insertApp: model.insertApp, notes: notes)
      if compact, action != card.primary, let glyph = labels.glyph(action) {
        IslandIconButton(glyph: glyph, label: labels.title(action), tooltip: tooltip) {
          model.perform(action)
        }
      } else {
        IslandTextButton(
          title: labels.title(action), tooltip: tooltip, rest: action == card.primary ? 0.08 : 0,
          keys: compact ? nil : keys, action: { model.perform(action) }
        )
        .accessibilityLabel(Text(verbatim: tooltip))
      }
    }
  }

  /// Discard: nothing of the version under review goes onto the image
  /// (``CaptureResultCardModel/discard()``).
  private func discard(compact: Bool) -> some View {
    IslandFeedbackButton(
      title: labels.discard, glyph: AnnotationIcons.cancel,
      workingLabel: labels.island.recording.actionWorking, compact: compact, feedback: nil
    ) { model.discard() }
  }

  /// Whether Copy copies an explanation's notes (its items, under review or not), not an answer
  /// or the new text of replacements.
  private static func listsNotes(_ card: CaptureResultCard) -> Bool {
    if case .items = card.body { true } else { false }
  }
}
