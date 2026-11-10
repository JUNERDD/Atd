import AICore
import SwiftUI

/// The recording's result card (architecture R9, R10, `record-result.js`), built around one
/// timeline: the cards' corner, padding, grabber (``IslandGrabber``), title row and footer
/// (``IslandShellTitle``, ``IslandShellFooter``) around the player with the steps Atd reads
/// beside it, the filmstrip that is both scrubber and trim under them, the ask field with the
/// quick asks (``IslandAskField``), and one answer slot (``IslandAskAnswerSlot``), the pieces it
/// shares with the long screenshot's card. Everything points at the same moment: the step at the
/// playhead is marked, a hovered step or mark shows its frame, a click goes there, a dragged
/// handle shows the frame it is on, hovering the strip shows that moment's frame in a bubble
/// above it, and steps outside the kept range are dimmed. The recording shows larger in the
/// card's lightbox (``IslandRecordingLightbox``), from the timeline's full screen preview button
/// or a double-click on the player, over the same card model.
///
/// Its state is the card model's (``IslandRecordingCardModel``); its size comes from
/// ``IslandController/measureRecordingCard()``, which this layout fills exactly. App names,
/// steps and answers are runtime data, shown untranslated.
struct IslandRecordingCard: View {
  let model: IslandModel
  let card: IslandRecordingCardModel
  /// The card that has the pointer; a leaving one is inert.
  let active: Bool
  let geometry: IslandShellGeometry
  /// The timeline's hover frame, drawn over the whole card.
  @State private var bubble = IslandRecordingFrameBubble(.card)

  var body: some View {
    let labels = model.labels.recording
    // Keep the fallback mounted for field focus, but enable its axis only when the measured
    // stack needs it. Native document/viewport updates during reflow otherwise briefly create
    // a scrollbar gutter even when their final heights match. Child scroll views stay active.
    VStack(spacing: 0) {
      // Outside the scroll view, so the card moves by its top edge however its contents scroll.
      IslandGrabber(model: model)
      ScrollView(geometry.contentHeight > geometry.height ? .vertical : []) {
        VStack(alignment: .leading, spacing: 0) {
          IslandRecordingTitle(model: model, card: card)
          sections
          IslandRecordingFooter(model: model, card: card)
        }
        .padding([.horizontal, .bottom], IslandMetrics.cardPadding)
        // The measured stack under the grabber is the scroll document, including during reflow.
        // An intrinsic minimum can briefly outrun its viewport and make AppKit add a gutter.
        .frame(
          height: max(geometry.contentHeight - IslandMetrics.grabberStrip, 0),
          alignment: .topLeading)
      }
      .modifier(FloatingScrollEdges(reduceMotion: model.reduceMotion))
    }
    .frame(width: geometry.width, height: geometry.height, alignment: .topLeading)
    .coordinateSpace(.named(IslandRecordingFrameBubble.space))
    .overlay(alignment: .topLeading) {
      IslandRecordingFrameBubbleView(
        bubble: bubble, card: card,
        bounds: CGSize(width: geometry.width, height: geometry.height))
    }
    .disabled(!active)
    .onDisappear { bubble.stop() }
    // Space plays or pauses only while no button has the keyboard focus.
    .onPreferenceChange(IslandControlFocus.self) { card.controlFocused = $0 }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.card(RecordingClock.text(card.source.duration))))
  }

  private var sections: some View {
    let labels = model.labels.recording
    let player = geometry.media
    return VStack(alignment: .leading, spacing: 0) {
      if !card.source.notes.isEmpty {
        IslandFadingScroll(reduceMotion: model.reduceMotion) {
          IslandRecordingNotes(notes: card.source.notes)
        }
        .frame(height: geometry.notesHeight)
        .padding(.horizontal, IslandMetrics.recordingInset)
        .padding(.vertical, IslandMetrics.recordingBodyTop)
      }
      HStack(alignment: .top, spacing: IslandMetrics.recordingBodyGap) {
        IslandRecordingPlayer(
          card: card, labels: labels, size: player, hint: labels.playerHint, reportsFrame: true
        ) { card.openLightbox() }
        IslandRecordingSteps(card: card, labels: labels, reduceMotion: model.reduceMotion)
          .frame(height: player.height)
          .frame(maxWidth: .infinity)
      }
      .padding(.horizontal, IslandMetrics.recordingInset)
      .padding(.top, IslandMetrics.recordingBodyTop)
      IslandRecordingTimeline(card: card, labels: labels, bubble: bubble) { card.openLightbox() }
        .padding(.leading, 4)
        .padding(.trailing, IslandMetrics.recordingInset)
        .padding(.top, IslandMetrics.recordingSectionGap)
      IslandAskField(
        asking: card.asking, labels: labels.asking, width: geometry.width,
        quickAsksHeight: geometry.quickAsksHeight
      )
      .padding(.top, IslandMetrics.recordingSectionGap)
      .padding(.bottom, IslandMetrics.recordingAskBottom)
      .padding(.horizontal, IslandMetrics.recordingInset)
      IslandAskAnswerSlot(
        model: model, asking: card.asking, labels: labels.asking,
        height: geometry.answerSlotHeight, rangeText: { RecordingClock.range($0) }
      ) { card.seek($0) }
      .padding(.horizontal, IslandMetrics.recordingInset)
    }
  }
}

/// Processing notes grow naturally up to their own scroll cap. The orchestrator supplies
/// already localized explanations; measuring this same view keeps wrapped notes in budget.
struct IslandRecordingNotes: View {
  let notes: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: IslandMetrics.sectionGap) {
      ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
        HStack(alignment: .top, spacing: 6) {
          IslandGlyph(name: IslandIcons.warning, side: 14).foregroundStyle(.secondary)
          Text(verbatim: note)
            .font(IslandType.hint)
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// The title row (``IslandShellTitle``): "Screen Recording", its duration (the kept length and
/// the whole once trimmed), the source app and the pixel size; "Restore" once trimmed; the close
/// button. Its own view, so a trim reads only here and in the views that show it.
private struct IslandRecordingTitle: View {
  let model: IslandModel
  let card: IslandRecordingCardModel

  var body: some View {
    let labels = model.labels.recording
    IslandShellTitle(
      model: model, title: labels.title, subtitle: card.subtitle(labels),
      restore: card.state.isTrimmed
        ? IslandShellTitle.Restore(label: labels.restore, tooltip: labels.restoreTooltip) {
          card.resetTrim()
        } : nil
    ) { model.recordingEvent(.close) }
  }
}

extension IslandRecordingCardModel {
  /// The title row's subtitle, the lightbox's top bar's too: its duration (the kept length and
  /// the whole once trimmed), the source app and the pixel size.
  func subtitle(_ labels: IslandRecordingLabels) -> String {
    let whole = RecordingClock.text(source.duration)
    let duration =
      state.isTrimmed
      ? labels.trimmed(kept: RecordingClock.text(state.trim.length), whole: whole) : whole
    let size = "\(source.pixelWidth) × \(source.pixelHeight)"
    return ([duration] + (source.appName.map { [$0] } ?? []) + [size]).joined(separator: " · ")
  }
}

/// The footer (``IslandShellFooter``) with the card's actions (``IslandRecordingActions``).
private struct IslandRecordingFooter: View {
  let model: IslandModel
  let card: IslandRecordingCardModel

  var body: some View {
    IslandShellFooter(model: model) { compact in
      IslandRecordingActions(card: card, labels: model.labels.recording, compact: compact)
    }
  }
}

/// Save, Copy (⌘C) and Attach to Conversation (⌘↩), each on the range kept now; Attach is the
/// primary action. Each reports how it went on its own button (``IslandShellFeedback``), so the
/// card stays. The card's footer and its lightbox's bottom bar show the same buttons over the
/// one card model, so a report shows on both. `compact` turns Save and Copy into glyphs and
/// drops Attach's keycap (``IslandFeedbackButton``).
struct IslandRecordingActions: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let compact: Bool

  var body: some View {
    let trim = card.state.trim
    let feedback = card.feedback.states
    IslandFeedbackButton(
      title: labels.save, glyph: "save", workingLabel: labels.actionWorking,
      tooltip: labels.save(to: card.source.saveFolder),
      compact: compact, feedback: feedback[.save]
    ) { card.onEvent(.save(trim)) }
    IslandFeedbackButton(
      title: labels.copy, glyph: "copy", workingLabel: labels.actionWorking,
      tooltip: labels.copyTooltip, keys: IslandShellFooterKey.copyKeys, compact: compact,
      feedback: feedback[.copy]
    ) { card.onEvent(.copy(trim)) }
    IslandFeedbackButton(
      title: labels.attach, glyph: "plus", workingLabel: labels.actionWorking,
      tooltip: labels.attachTooltip, keys: IslandShellFooterKey.attachKeys, primary: true,
      compact: compact, feedback: feedback[.attach]
    ) { card.onEvent(.attach(trim)) }
  }
}
