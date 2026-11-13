import AICore
import AppKit
import SwiftUI

/// The answer card the island grows into where a run's answer could not be written (its target
/// cannot take text, or the write was refused): the options card's corner, padding, title row
/// and footer (``IslandCard``) around the answer, under the grabber that moves the island
/// (``IslandGrabber``) in place of the top padding. The title is the command's name with a close
/// button; the page's note, when it gave one, says under it why nothing was written; the
/// answer, selectable, scrolls inside the card once the card would be taller than the island's
/// largest shape, so the title and the footer always show, fading out at an edge with more of
/// it past it (``IslandFadingScroll``). The footer has the key hints and
/// Open in Atd beside Copy, and, while the person's focus is a field that can take text
/// (``IslandModel/answerOffer``), Insert, with Replace beside it while that field has a
/// selection (``IslandWriteButtons``). They come and go in a fade as the focus moves. While the
/// answer streams in (``IslandAnswer/streaming``) the scroll follows its newest text, Stop takes
/// the place of Copy and the writes, and the close button cancels the run. The command's name and
/// the answer are user data, shown untranslated; the name is cut with an ellipsis.
///
/// `width` nil lays the card out at its ideal width and `height` nil with the answer at its
/// full height, unscrolled, which is how the controller measures it (``measureAnswer``).
struct IslandAnswerCard: View {
  let model: IslandModel
  let command: String
  let answer: IslandAnswer
  let note: String?
  let offer: AnswerWriteOffer?
  var width: Double?
  var height: Double?

  /// The most of an answer the card measures. A longer one overflows the card's room at any
  /// width the card takes (even its narrowest glyphs wrap to more lines than the room holds),
  /// so measuring the rest would only cost time.
  static let measuredLength = 4000

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      IslandGrabber(model: model)
      content.padding([.horizontal, .bottom], IslandMetrics.cardPadding)
    }
    .frame(
      width: width.map { CGFloat($0) }, height: height.map { CGFloat($0) }, alignment: .topLeading
    )
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.answer(command)))
  }

  var chromeWidthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
      footer.widthProbe
    }
    .padding(IslandMetrics.cardPadding)
  }

  var widthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
      IslandAnswerText(text: answer.text)
      footer.widthProbe
    }
    .padding(IslandMetrics.cardPadding)
  }

  /// The title (with the note), the answer and the footer, stacked; measured, the answer shows
  /// at its full height, and shown, it scrolls in the room between them.
  private var content: some View {
    let text = IslandAnswerText(text: answer.text).padding(.vertical, IslandMetrics.sectionGap)
    return VStack(alignment: .leading, spacing: 0) {
      top
      if height == nil {
        text
      } else {
        IslandFadingScroll(reduceMotion: model.reduceMotion, follows: answer.streaming) { text }
          .frame(maxHeight: .infinity, alignment: .top)
      }
      footer
    }
  }

  /// The title row, and the note under it when the page gave one.
  private var top: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if let note { IslandAnswerNote(text: note).padding(.bottom, IslandMetrics.noteGap) }
    }
  }

  /// The command's name, as the options card's title, and the close button, which cancels the
  /// run while its answer streams in, as the working capsule's does.
  private var header: some View {
    let labels = model.labels
    return IslandResultHeader(
      title: command, close: answer.streaming ? labels.cancel : labels.close
    ) { model.act(.dismiss) }
  }

  var footer: IslandResultFooter {
    IslandResultFooter(
      model: model, offer: offer, pending: answer.streaming, stops: answer.streaming)
  }
}

/// The answer and review cards' Insert, and Replace beside it while the focused field has a
/// selection, writing into the field the person's focus is in. Insert writes after the selection
/// while there is one (``AnswerWriteOffer/insert``), at the focus otherwise. Each names the app
/// in its tooltip and VoiceOver name and shows the keys that perform it
/// (``AnswerWriteOffer/keys(for:)``); the primary one (``AnswerWriteOffer/primary``) has the
/// Run button's fill.
struct IslandWriteButtons: View {
  let model: IslandModel
  let offer: AnswerWriteOffer
  var showsKeys = true

  var body: some View {
    HStack(spacing: IslandMetrics.gap) {
      button(offer.insert)
      if offer.replaces { button(.selection) }
    }
  }

  private func button(_ mode: TextWriteParams.Mode) -> some View {
    let labels = model.labels
    let replace = mode == .selection
    let tooltip =
      replace
      ? labels.replace(in: offer.app)
      : offer.replaces ? labels.insertAfter(in: offer.app) : labels.insert(in: offer.app)
    return IslandTextButton(
      title: replace ? labels.replace : labels.insert,
      tooltip: tooltip + " " + offer.keys(for: mode),
      rest: offer.primary == mode ? 0.08 : 0, keys: showsKeys ? offer.keys(for: mode) : nil,
      action: { model.act(.write(mode)) }
    )
    .accessibilityLabel(Text(verbatim: tooltip))
    .transition(.opacity)
  }
}

/// The page's note under the title: why the answer was not written, in the hint type, wrapping
/// to ``IslandMetrics/maxNoteLines`` lines.
struct IslandAnswerNote: View {
  let text: String

  var body: some View {
    Text(verbatim: text)
      .font(IslandType.hint)
      .foregroundStyle(.secondary)
      .lineLimit(IslandMetrics.maxNoteLines)
      .truncationMode(.tail)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, IslandMetrics.rowPadding)
      .frame(maxWidth: IslandMetrics.resultTextWidth, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
      .help(text)
  }
}

/// Cached chrome dimensions for ``IslandController/measureAnswer(command:answer:note:)`` so
/// streaming chunks only re-measure the answer text via ``ResultTextMeasure``.
struct AnswerMeasureCache {
  struct Key: Equatable {
    let command: String
    let note: String?
    let offer: AnswerWriteOffer?
    let streaming: Bool
    let labels: IslandLabels
  }

  var key: Key?
  var chromeIdealWidth = 0.0
  var measuredWidth = 0.0
  var noteHeight = 0.0
  var footerHeight = 0.0
}

extension IslandController {
  /// The answer card's rest size: as wide as its widest part (title, note, the answer's longest
  /// line, footer) within ``resultCardWidth(ideal:)``, and as tall as its note and its
  /// answer wrap to at that width, up to the island's largest shape
  /// (``IslandMetrics/answerCardHeight(note:answer:)``). A card whose answer streamed in never
  /// narrows as it grows or settles: it keeps the widest it has been.
  func measureAnswer(command: String, answer: IslandAnswer, note: String?) -> IslandMeasure {
    let sample = IslandAnswer(
      text: String(answer.text.prefix(IslandAnswerCard.measuredLength)),
      streaming: answer.streaming)
    let card = IslandAnswerCard(
      model: model, command: command, answer: sample, note: note, offer: model.answerOffer)
    let key = AnswerMeasureCache.Key(
      command: command, note: note, offer: model.answerOffer, streaming: answer.streaming,
      labels: model.labels)
    if answerMeasures.key != key {
      answerMeasures = AnswerMeasureCache(
        key: key,
        chromeIdealWidth: Self.fittingSize(of: card.chromeWidthProbe.fixedSize()).width)
    }
    let textIdealWidth =
      IslandAnswerText.measuredIdealWidth(text: sample.text) + IslandMetrics.cardPadding * 2
    let ideal = resultCardWidth(ideal: max(answerMeasures.chromeIdealWidth, textIdealWidth))
    let streamed = if case .answer(_, let shown, _) = content { shown.streaming } else { false }
    let width = streamed ? max(ideal, size?.width ?? 0) : ideal
    let inner = width - IslandMetrics.cardPadding * 2
    if answerMeasures.measuredWidth != width {
      answerMeasures.measuredWidth = width
      answerMeasures.noteHeight =
        note.map { Self.height(of: IslandAnswerNote(text: $0), width: inner) } ?? 0
      answerMeasures.footerHeight = Self.height(of: card.footer, width: inner)
    }
    let answerHeight = IslandAnswerText.measuredHeight(text: sample.text, width: inner)
    return IslandMeasure(
      size: WindowSize(
        width: width,
        height: IslandMetrics.answerCardHeight(
          note: answerMeasures.noteHeight, answer: answerHeight,
          footer: answerMeasures.footerHeight)))
  }

  /// The height `view` takes laid out `width` points wide, wrapping as it needs.
  static func height(of view: some View, width: Double) -> Double {
    let framed = view.frame(width: width).fixedSize(horizontal: false, vertical: true)
    return fittingSize(of: framed).height
  }
}

/// A result card's title row: the command's name in the secondary label type, cut with an
/// ellipsis, what the card puts beside it (the screenshot text command's review card: its
/// versions and Regenerate), and the close button's × (the island's answer card and the
/// screenshot text command's result card), named `close`.
struct IslandResultHeader<Accessory: View>: View {
  let title: String
  let close: String
  @ViewBuilder let accessory: Accessory
  let onClose: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Text(verbatim: title)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.leading, IslandMetrics.rowPadding)
        .help(title)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      accessory
      IslandIconButton(glyph: AnnotationIcons.cancel, label: close, action: onClose)
    }
    .frame(height: IslandMetrics.headerHeight)
  }
}

extension IslandResultHeader where Accessory == EmptyView {
  init(title: String, close: String, onClose: @escaping () -> Void) {
    self.init(title: title, close: close, accessory: { EmptyView() }, onClose: onClose)
  }
}
