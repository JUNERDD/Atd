import AICore
import AppKit
import SwiftUI

/// The answer card the island grows into where a run's answer could not be written (its target
/// cannot take text, or the write was refused): the options card's corner, padding, title row
/// and footer (``IslandCard``) around the answer. The title is the command's name with a close
/// button; the page's note, when it gave one, says under it why nothing was written; the
/// answer, selectable, scrolls inside the card once the card would be taller than the island's
/// largest shape, so the title and the footer always show, fading out at an edge with more of
/// it past it (``IslandFadingScroll``). The footer has the key hints and
/// Open in Atd beside Copy, and, while the person's focus is a field that can take text
/// (``IslandModel/answerOffer``), Insert, with Replace beside it while that field has a
/// selection; the primary of them carries the Return keycap. They come and go in a fade as the
/// focus moves. The command's name and the answer are user data, shown untranslated; the name is
/// cut with an ellipsis.
///
/// `width` nil lays the card out at its ideal width and `height` nil with the answer at its
/// full height, unscrolled, which is how the controller measures it (``measureAnswer``).
struct IslandAnswerCard: View {
  let model: IslandModel
  let command: String
  let answer: String
  let note: String?
  var width: Double?
  var height: Double?

  /// The most of an answer the card measures. A longer one overflows the card's room at any
  /// width the card takes (even its narrowest glyphs wrap to more lines than the room holds),
  /// so measuring the rest would only cost time.
  static let measuredLength = 4000

  var body: some View {
    content
      .padding(IslandMetrics.cardPadding)
      .frame(
        width: width.map { CGFloat($0) }, height: height.map { CGFloat($0) }, alignment: .topLeading
      )
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(verbatim: model.labels.answer(command)))
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

  private var footer: some View {
    let labels = model.labels
    return HStack(spacing: 10) {
      IslandKeyHint(keys: "⌘C", label: labels.copy)
      IslandKeyHint(keys: "esc", label: labels.close)
      Spacer(minLength: 8)
      HStack(spacing: IslandMetrics.gap) {
        IslandTextButton(title: labels.openInAtd, tooltip: labels.openInAtdTooltip) {
          model.act(.open)
        }
        IslandTextButton(title: labels.copy, rest: 0.08, action: { model.act(.copy) }) {
          EmptyView()
        }
        if let offer = model.answerOffer {
          write(.cursor, offer)
          if offer.replaces { write(.selection, offer) }
        }
      }
      .animation(.easeOut(duration: 0.2), value: model.answerOffer)
    }
    .padding(.leading, 4)
    .frame(height: IslandMetrics.footerHeight)
  }
}

extension IslandAnswerCard {
  /// Insert (`cursor`) or Replace (`selection`) into the field the person's focus is in, its
  /// tooltip and VoiceOver name naming the app, each with the keys that perform it
  /// (``AnswerWriteOffer/keys(for:)``); the primary one (``AnswerWriteOffer/primary``) has the
  /// Run button's fill.
  fileprivate func write(_ mode: TextWriteParams.Mode, _ offer: AnswerWriteOffer) -> some View {
    let labels = model.labels
    let replace = mode == .selection
    let tooltip = replace ? labels.replace(in: offer.app) : labels.insert(in: offer.app)
    let primary = offer.primary == mode
    return IslandTextButton(
      title: replace ? labels.replace : labels.insert, tooltip: tooltip, rest: primary ? 0.08 : 0,
      action: { model.act(.write(mode)) }
    ) {
      IslandKeycap(symbol: offer.keys(for: mode))
    }
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
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension IslandType {
  /// The answer card's answer: the label size at regular weight.
  static let answer = Font.system(size: 13)
}

extension IslandController {
  /// The answer card's rest size: as wide as its widest part (title, note, the answer's longest
  /// line, footer) within ``IslandMetrics/cardWidth(ideal:)``, and as tall as its note and its
  /// answer wrap to at that width, up to the island's largest shape
  /// (``IslandMetrics/answerCardHeight(note:answer:)``).
  func measureAnswer(command: String, answer: String, note: String?) -> IslandMeasure {
    let sample = String(answer.prefix(IslandAnswerCard.measuredLength))
    let card = IslandAnswerCard(model: model, command: command, answer: sample, note: note)
    let width = IslandMetrics.cardWidth(
      ideal: NSHostingView(rootView: card.fixedSize()).fittingSize.width)
    let inner = width - IslandMetrics.cardPadding * 2
    let noteHeight = note.map { Self.height(of: IslandAnswerNote(text: $0), width: inner) } ?? 0
    let answerHeight = Self.height(of: IslandAnswerText(text: sample), width: inner)
    return IslandMeasure(
      size: WindowSize(
        width: width,
        height: IslandMetrics.answerCardHeight(note: noteHeight, answer: answerHeight)))
  }

  /// The height `view` takes laid out `width` points wide, wrapping as it needs.
  static func height(of view: some View, width: Double) -> Double {
    let framed = view.frame(width: width).fixedSize(horizontal: false, vertical: true)
    return NSHostingView(rootView: framed).fittingSize.height
  }
}
