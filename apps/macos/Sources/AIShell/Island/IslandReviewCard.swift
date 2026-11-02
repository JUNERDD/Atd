import AICore
import AppKit
import SwiftUI

/// The review card the island grows into where a command's answer waits for review before it is
/// written (contract: `commandProgress.show`'s answer with `review`): the answer card's corner,
/// padding, title row and footer around the original, the answer, an adjust field that always
/// shows and a row of chips. The title is the command's name (with the value of a lone choice
/// offered as chips); the header has, while the next version is being made, a spinner and what is
/// happening, otherwise a pager once there are several versions, then Regenerate and close. The
/// original (``IslandReviewSource``) sits above the answer, which shows its changes against it
/// while they are on, dims while a version is pending, and scrolls inside the card once the card
/// would be taller than the island's largest shape. The chips stage option values
/// (``ReviewOptionChips``: a lone short choice's values, else one summary chip that opens the
/// options sheet) and the command's adjustments; the field's text and everything staged go to the
/// page together, as one adjustment, from the send button or Return. The footer is the answer
/// card's, Copy and the writes waiting while a version is pending.
///
/// The draft is the model's (``IslandModel/review``); every change goes to the controller as an
/// ``IslandReviewEvent``. Keys reach the card through its window first
/// (``CommandProgressController/reviewKey(_:)``). The command's name, the answer, the original,
/// option labels and adjustments are user data, shown untranslated.
///
/// `width` nil lays the card out at its ideal width and `height` nil with the answer at its full
/// height, unscrolled, which is how the controller measures it
/// (``IslandController/measureReview(command:answer:note:review:)``).
struct IslandReviewCard: View {
  let model: IslandModel
  let command: String
  let answer: String
  let note: String?
  let review: CommandProgressState.Review
  let offer: AnswerWriteOffer?
  /// The card that has the pointer and the keyboard; a leaving one is inert.
  var active = false
  var width: Double?
  var height: Double?
  @FocusState private var fieldFocused: Bool

  private var pending: Bool { review.pending != nil }
  /// The review has as many versions as it may make: Regenerate and Send rest, and say why.
  private var full: Bool { review.count >= CommandProgressState.Review.maxVersions }
  private var chips: ReviewOptionChips { ReviewOptionChips(review.options) }
  private var marksChanges: Bool { review.changes != nil && model.review.showsChanges }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
      answerView
      field.padding(.top, IslandMetrics.sectionGap)
      if !review.chipRow.isEmpty {
        chipRow.padding(.top, IslandMetrics.reviewChipsTop)
      }
      footer.padding(.top, IslandMetrics.sectionGap)
    }
    .padding(IslandMetrics.cardPadding)
    .frame(
      width: width.map { CGFloat($0) }, height: height.map { CGFloat($0) }, alignment: .topLeading
    )
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.answer(command)))
  }

  /// The title row, the footer, the original and the answer at their ideal widths: what the
  /// card's width follows, so typing and staging chips never change it.
  var widthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
      IslandAnswerText(text: answer)
      footer.widthProbe
    }
    .padding(IslandMetrics.cardPadding)
  }

  /// The title row, the note under it when the page gave one, and the original.
  private var top: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if let note { IslandAnswerNote(text: note).padding(.bottom, IslandMetrics.noteGap) }
      if let source = review.source {
        IslandReviewSource(model: model, source: source, changes: review.changes != nil)
      }
    }
  }

  private var header: some View {
    let labels = model.labels
    return HStack(spacing: 8) {
      Text(verbatim: title)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.leading, IslandMetrics.rowPadding)
        .help(title)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      if let pending = review.pending {
        HStack(spacing: 6) {
          IslandSpinner(side: 12)
          Text(verbatim: labels.review.pending(pending))
            .font(IslandType.hint).foregroundStyle(.secondary).lineLimit(1).fixedSize()
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
      } else if review.count > 1 {
        pager
      }
      HStack(spacing: IslandMetrics.gap) {
        IslandIconButton(
          glyph: IslandIcons.regenerate, label: labels.review.regenerate,
          tooltip: full ? labels.review.limit : labels.review.regenerate + " ⌘R"
        ) { model.reviewEvent(.regenerate) }
        .disabled(!review.takesVersion)
        .opacity(review.takesVersion ? 1 : 0.38)
        IslandIconButton(glyph: AnnotationIcons.cancel, label: labels.close) {
          model.act(.dismiss)
        }
      }
    }
    .frame(height: IslandMetrics.headerHeight)
  }

  /// The command's name, and the value a lone choice shown as chips ran with.
  private var title: String {
    guard case .values(let choice) = chips else { return command }
    let value = OptionsCard.valueLabel(of: choice)
    return value.isEmpty ? command : command + " · " + value
  }

  /// ‹ version / count ›, each arrow off at its end.
  private var pager: some View {
    let labels = model.labels.review
    let side = IslandMetrics.reviewPagerSide
    return HStack(spacing: 0) {
      IslandIconButton(glyph: IslandIcons.scrollLeft, label: labels.previous, side: side) {
        model.reviewEvent(.version(review.version - 1))
      }
      .disabled(review.version <= 1)
      .opacity(review.version <= 1 ? 0.38 : 1)
      Text(verbatim: "\(review.version) / \(review.count)")
        .font(IslandType.hint).foregroundStyle(.secondary).monospacedDigit().fixedSize()
      IslandIconButton(glyph: IslandIcons.scrollRight, label: labels.next, side: side) {
        model.reviewEvent(.version(review.version + 1))
      }
      .disabled(review.version >= review.count)
      .opacity(review.version >= review.count ? 0.38 : 1)
    }
  }

  /// The answer, marked or plain; measured it shows at its full height, shown it scrolls in the
  /// room the rest leaves.
  @ViewBuilder private var answerView: some View {
    let text = Group {
      if marksChanges, let changes = review.changes {
        IslandReviewMarkedAnswer(changes: changes)
      } else {
        IslandAnswerText(text: answer)
      }
    }
    .padding(.vertical, IslandMetrics.sectionGap)
    .opacity(pending ? 0.32 : 1)
    .animation(.easeOut(duration: 0.2), value: pending)
    if height == nil {
      text
    } else {
      IslandFadingScroll(reduceMotion: model.reduceMotion) { text }
        .frame(maxHeight: .infinity, alignment: .top)
    }
  }

  /// The adjust field on its capsule wash, its placeholder counting what is staged once the
  /// field is empty, and the send button.
  private var field: some View {
    let draft = model.review
    let labels = model.labels
    let placeholder =
      full
      ? labels.review.limit
      : draft.count > 0 && draft.text.isEmpty
        ? labels.review.staged(draft.count) : labels.review.placeholder
    let text = Binding(get: { model.review.text }, set: { model.reviewEvent(.text($0)) })
    return HStack(spacing: 6) {
      TextField(text: text, prompt: Text(verbatim: placeholder)) {
        Text(verbatim: labels.review.placeholder)
      }
      .textFieldStyle(.plain)
      .font(IslandType.answer)
      .lineLimit(1)
      .focused($fieldFocused)
      .disabled(!active)
      if !review.chipRow.isEmpty {
        IslandKeyHint(keys: "↓", label: labels.review.keyOptions)
          .opacity(model.reviewChip == nil ? 1 : 0)
          .accessibilityHidden(model.reviewChip != nil)
      }
      IslandReviewSendButton(
        ready: draft.canSend && review.takesVersion, label: labels.review.send,
        tooltip: full ? labels.review.limit : nil
      ) { model.reviewEvent(.send) }
    }
    .padding(.leading, 10)
    .padding(.trailing, 4)
    .frame(height: IslandMetrics.reviewFieldHeight)
    .background { IslandWash(level: 0.07, shape: Capsule()) }
    .padding(.horizontal, 2)
    // As the compose card's field: focus once the card is active and its window has the
    // keyboard, and again when the window takes it back.
    .onChange(of: active && model.cardIsKey, initial: true) { _, focus in fieldFocused = focus }
  }

  /// The option chips, a hairline, then the adjustment chips, wrapping; the chip the keyboard
  /// highlights (``IslandModel/reviewChip``) has a focus ring while the card has the keyboard.
  private var chipRow: some View {
    let row = review.chipRow
    let firstAdjustment = row.count - review.adjustments.count
    let highlight = active && model.cardIsKey ? model.reviewChip : nil
    return IslandChipFlow {
      ForEach(Array(row.enumerated()), id: \.offset) { index, chip in
        if index == firstAdjustment, index > 0 {
          Rectangle().fill(Color.primary.opacity(0.14)).frame(width: 1, height: 14)
            .padding(.horizontal, 3).accessibilityHidden(true)
        }
        chipView(chip, focused: index == highlight)
      }
    }
    .padding(.horizontal, 4)
  }

  @ViewBuilder private func chipView(_ chip: ReviewChip, focused: Bool) -> some View {
    let draft = model.review
    switch chip {
    case .value(let key, let value):
      IslandReviewChip(
        title: value.label.isEmpty ? value.value : value.label,
        selected: draft.choice(key) == value.value, focused: focused
      ) { model.reviewEvent(chip.event) }
    case .summary:
      let summary =
        draft.changesOptions
        ? ReviewOptionChips.summary(of: draft.values) : review.summary
      IslandReviewSummaryChip(
        summary: summary ?? model.labels.change, staged: draft.changesOptions,
        label: model.labels.change, focused: focused
      ) { model.reviewEvent(chip.event) }
    case .adjustment(let adjustment):
      IslandReviewChip(title: adjustment, selected: draft.chose(adjustment), focused: focused) {
        model.reviewEvent(chip.event)
      }
    }
  }

  private var footer: IslandResultFooter {
    IslandResultFooter(
      model: model, offer: offer, pending: pending, showsOptionHint: !review.chipRow.isEmpty)
  }
}

extension IslandController {
  /// The review card's rest size: as wide as its title row, original, answer and footer within
  /// ``resultCardWidth(ideal:)``, and as tall as everything wraps to at that width, up to
  /// the island's largest shape (``IslandMetrics/reviewCardHeight(natural:)``). A long answer is
  /// measured by its first ``IslandAnswerCard/measuredLength`` characters, as the answer card's.
  func measureReview(
    command: String, answer: String, note: String?, review: CommandProgressState.Review
  ) -> IslandMeasure {
    let limit = IslandAnswerCard.measuredLength
    let card = IslandReviewCard(
      model: model, command: command, answer: String(answer.prefix(limit)), note: note,
      review: review.measured(limit: limit), offer: model.answerOffer)
    let width = resultCardWidth(
      ideal: NSHostingView(rootView: card.widthProbe.fixedSize()).fittingSize.width)
    let natural = Self.height(of: card, width: width)
    return IslandMeasure(
      size: WindowSize(width: width, height: IslandMetrics.reviewCardHeight(natural: natural)))
  }
}

extension CommandProgressState.Review {
  /// The review with its original and changes cut to about `limit` characters, which is all that
  /// can show in the card's largest shape.
  fileprivate func measured(limit: Int) -> Self {
    let changes = changes.map { runs in
      var left = limit
      var kept: [Change] = []
      for run in runs where left > 0 {
        let text = String(run.text.prefix(left))
        left -= text.count
        kept.append(Change(kind: run.kind, text: text))
      }
      return kept
    }
    return Self(
      source: source.map { String($0.prefix(limit)) }, changes: changes, version: version,
      count: count, options: options, summary: summary, adjustments: adjustments,
      pending: pending)
  }
}
