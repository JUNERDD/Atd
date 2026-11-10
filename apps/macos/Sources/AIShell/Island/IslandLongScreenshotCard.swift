import AICore
import SwiftUI

/// The long screenshot's result card (decision D11, `longshot-result.js`), built from the
/// recording card's pieces: the grabber (``IslandGrabber``), the title row and footer
/// (``IslandShellTitle``, ``IslandShellFooter``), the ask field with its quick asks
/// (``IslandAskField``) and the one answer slot (``IslandAskAnswerSlot``), around a body of the
/// whole image with the kept range between two handles (``IslandLongScreenshotPreview``) and
/// what Atd reads of it beside it (``IslandLongScreenshotReads``). Everything acts on the kept
/// range: a hovered page is marked on the image and in its row together.
///
/// Its state is the card model's (``IslandLongScreenshotCardModel``); its size comes from
/// ``IslandController/measureLongScreenshotCard()``, which this layout fills exactly. App names,
/// recognized text and answers are runtime data, shown untranslated.
struct IslandLongScreenshotCard: View {
  let model: IslandModel
  let card: IslandLongScreenshotCardModel
  /// The card that has the pointer; a leaving one is inert.
  let active: Bool
  let geometry: IslandShellGeometry

  var body: some View {
    let labels = model.labels.longScreenshot
    let size = card.source.shot.pointSize
    // As the recording card: the fallback scroll view stays mounted for field focus, its axis
    // on only when the measured stack needs it, so reflow never adds a scrollbar gutter.
    VStack(spacing: 0) {
      // Outside the scroll view, so the card moves by its top edge however its contents scroll.
      IslandGrabber(model: model)
      ScrollView(geometry.contentHeight > geometry.height ? .vertical : []) {
        VStack(alignment: .leading, spacing: 0) {
          IslandLongScreenshotTitle(model: model, card: card)
          sections(labels)
          IslandLongScreenshotFooter(model: model, card: card)
        }
        .padding([.horizontal, .bottom], IslandMetrics.cardPadding)
        // The measured stack under the grabber is the scroll document, including during reflow.
        .frame(
          height: max(geometry.contentHeight - IslandMetrics.grabberStrip, 0),
          alignment: .topLeading)
      }
      .modifier(FloatingScrollEdges(reduceMotion: model.reduceMotion))
    }
    .frame(width: geometry.width, height: geometry.height, alignment: .topLeading)
    .disabled(!active)
    // The arrows stay with a button that has the keyboard focus.
    .onPreferenceChange(IslandControlFocus.self) { card.controlFocused = $0 }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(
      Text(
        verbatim: labels.card(
          IslandLongScreenshotLabels.points(size.width) + " × "
            + IslandLongScreenshotLabels.points(size.height))))
  }

  private func sections(_ labels: IslandLongScreenshotLabels) -> some View {
    let box = geometry.media
    return VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: IslandMetrics.recordingBodyGap) {
        IslandLongScreenshotPreview(card: card, labels: labels, box: box)
        IslandLongScreenshotReads(card: card, labels: labels, reduceMotion: model.reduceMotion)
          .frame(height: box.height)
          .frame(maxWidth: .infinity)
      }
      .padding(.horizontal, IslandMetrics.recordingInset)
      .padding(.top, IslandMetrics.recordingBodyTop)
      IslandAskField(
        asking: card.asking, labels: labels.asking, width: geometry.width,
        quickAsksHeight: geometry.quickAsksHeight
      )
      .padding(.top, IslandMetrics.recordingSectionGap)
      .padding(.bottom, IslandMetrics.recordingAskBottom)
      .padding(.horizontal, IslandMetrics.recordingInset)
      IslandAskAnswerSlot(
        model: model, asking: card.asking, labels: labels.asking,
        height: geometry.answerSlotHeight, rangeText: { labels.keptHeight($0) }
      )
      .padding(.horizontal, IslandMetrics.recordingInset)
    }
  }
}

/// The title row (``IslandShellTitle``): "Long Screenshot", the size, screens and app of what is
/// kept (``IslandLongScreenshotLabels/subtitle(_:)``), "Restore" while it is trimmed or covered,
/// and the close button. Its own view, so the kept range reads only here and in the views that
/// show it.
private struct IslandLongScreenshotTitle: View {
  let model: IslandModel
  let card: IslandLongScreenshotCardModel

  var body: some View {
    let labels = model.labels.longScreenshot
    IslandShellTitle(
      model: model, title: labels.title, subtitle: labels.subtitle(card.state),
      restore: card.state.canRestore
        ? IslandShellTitle.Restore(label: labels.restore, tooltip: labels.restoreTooltip) {
          card.restore()
        } : nil
    ) { card.onEvent(.close) }
  }
}

/// The footer (``IslandShellFooter``): Annotate, which opens the lightbox in annotate mode, Copy
/// (⌘C) and Attach to Conversation (⌘↩), each on the range kept now (its cover and annotations
/// with it); Attach is the primary action. Copy and Attach report how they went on their own
/// buttons (``IslandShellFeedback``), so the card stays.
private struct IslandLongScreenshotFooter: View {
  let model: IslandModel
  let card: IslandLongScreenshotCardModel

  var body: some View {
    IslandShellFooter(model: model) { compact in
      let labels = model.labels.longScreenshot
      let kept = card.state.kept
      let feedback = card.feedback.states
      IslandFeedbackButton(
        title: labels.annotate, glyph: "pencil", workingLabel: labels.actionWorking,
        tooltip: labels.annotateTooltip, compact: compact, feedback: nil
      ) { card.openLightbox(nil, true) }
      IslandFeedbackButton(
        title: labels.copy, glyph: "copy", workingLabel: labels.actionWorking,
        tooltip: labels.copyTooltip, keys: IslandShellFooterKey.copyKeys, compact: compact,
        feedback: feedback[.copy]
      ) { card.onEvent(.copy(kept)) }
      IslandFeedbackButton(
        title: labels.attach, glyph: "plus", workingLabel: labels.actionWorking,
        tooltip: labels.attachTooltip, keys: IslandShellFooterKey.attachKeys, primary: true,
        compact: compact, feedback: feedback[.attach]
      ) { card.onEvent(.attach(kept)) }
    }
  }
}
