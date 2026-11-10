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
/// selection (``IslandWriteButtons``). They come and go in a fade as the focus moves. The command's name and the answer are user data, shown untranslated; the name is
/// cut with an ellipsis.
///
/// `width` nil lays the card out at its ideal width and `height` nil with the answer at its
/// full height, unscrolled, which is how the controller measures it (``measureAnswer``).
struct IslandAnswerCard: View {
  let model: IslandModel
  let command: String
  let answer: String
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

  var widthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
      IslandAnswerText(text: answer)
      footer.widthProbe
    }
    .padding(IslandMetrics.cardPadding)
  }

  /// The title (with the note), the answer and the footer, stacked; measured, the answer shows
  /// at its full height, and shown, it scrolls in the room between them.
  private var content: some View {
    let text = IslandAnswerText(text: answer).padding(.vertical, IslandMetrics.sectionGap)
    return VStack(alignment: .leading, spacing: 0) {
      top
      if height == nil {
        text
      } else {
        IslandFadingScroll(reduceMotion: model.reduceMotion) { text }
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

  /// The command's name, as the options card's title, and the close button.
  private var header: some View {
    HStack(spacing: 8) {
      Text(verbatim: command)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.leading, IslandMetrics.rowPadding)
        .help(command)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      IslandIconButton(glyph: AnnotationIcons.cancel, label: model.labels.close) {
        model.act(.dismiss)
      }
    }
    .frame(height: IslandMetrics.headerHeight)
  }

  var footer: IslandResultFooter {
    IslandResultFooter(model: model, offer: offer)
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

/// The answer: the label type at regular weight in the label colour, wrapping, selectable.
struct IslandAnswerText: View {
  let text: String

  var body: some View {
    Text(verbatim: text)
      .font(IslandType.answer)
      .foregroundStyle(.primary)
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, IslandMetrics.rowPadding)
      .frame(maxWidth: IslandMetrics.resultTextWidth, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension IslandType {
  /// The answer card's answer: the label size at regular weight.
  static let answer = Font.system(size: 13)
}

extension IslandController {
  /// The answer card's rest size: as wide as its widest part (title, note, the answer's longest
  /// line, footer) within ``resultCardWidth(ideal:)``, and as tall as its note and its
  /// answer wrap to at that width, up to the island's largest shape
  /// (``IslandMetrics/answerCardHeight(note:answer:)``).
  func measureAnswer(command: String, answer: String, note: String?) -> IslandMeasure {
    let sample = String(answer.prefix(IslandAnswerCard.measuredLength))
    let card = IslandAnswerCard(
      model: model, command: command, answer: sample, note: note, offer: model.answerOffer)
    let width = resultCardWidth(
      ideal: NSHostingView(rootView: card.widthProbe.fixedSize()).fittingSize.width)
    let inner = width - IslandMetrics.cardPadding * 2
    let noteHeight = note.map { Self.height(of: IslandAnswerNote(text: $0), width: inner) } ?? 0
    let answerHeight = Self.height(of: IslandAnswerText(text: sample), width: inner)
    let footerHeight = Self.height(of: card.footer, width: inner)
    return IslandMeasure(
      size: WindowSize(
        width: width,
        height: IslandMetrics.answerCardHeight(
          note: noteHeight, answer: answerHeight, footer: footerHeight)))
  }

  /// The height `view` takes laid out `width` points wide, wrapping as it needs.
  static func height(of view: some View, width: Double) -> Double {
    let framed = view.frame(width: width).fixedSize(horizontal: false, vertical: true)
    return NSHostingView(rootView: framed).fittingSize.height
  }
}
