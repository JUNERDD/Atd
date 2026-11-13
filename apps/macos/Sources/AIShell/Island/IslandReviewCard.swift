import AICore
import AppKit
import SwiftUI

/// The review card the island grows into where a command's answer waits for review before it is
/// written (contract: `commandProgress.show`'s answer with `review`): the answer card's corner,
/// padding, grabber, title row and footer around the original, the answer, an adjust field that
/// always shows and a row of chips. The title is the command's name (with the value of a lone choice
/// offered as chips); the header has, while the next version is being made, a spinner and what is
/// happening, a pager once there are several pages, then Regenerate and close. The version being
/// made has a page of its own after the kept ones, shown as soon as it is asked for, where its
/// answer streams in (``CommandProgressState/Review/showsPending``); the pager keeps working
/// meanwhile, and every page opens at its top. The original (``IslandReviewSource``) sits above
/// the answer, which shows its changes against it while they are on, and scrolls inside the card
/// once the card would be taller than the island's largest shape, following a streaming answer's
/// newest text. The chips stage option values
/// (``ReviewOptionChips``: a lone short choice's values, else one summary chip that opens the
/// options sheet) and the command's adjustments; the field's text and everything staged go to the
/// page together, as one adjustment, from the send button or Return. The footer is the answer
/// card's, Copy and the writes waiting while a version is pending. Another version changes the
/// card in place: the answer, chips and title fade across while the count rolls, and the card
/// keeps its width, its height following the answer (``IslandLayer/reflows``).
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
  var includesAnswer = true
  @FocusState private var fieldFocused: Bool

  private var pending: Bool { review.pending != nil }
  /// The card is on the page of the version being made, whose answer streams in.
  private var streaming: Bool { review.showsPending }
  /// The review has as many versions as it may make: Regenerate and Send rest, and say why.
  private var full: Bool { review.count >= CommandProgressState.Review.maxVersions }
  private var chips: ReviewOptionChips { ReviewOptionChips(review.options) }
  private var marksChanges: Bool { review.changes != nil && model.review.showsChanges }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      IslandGrabber(model: model)
      VStack(alignment: .leading, spacing: 0) {
        top
        if includesAnswer { answerView }
        field.padding(.top, IslandMetrics.sectionGap)
        if !review.chipRow.isEmpty {
          Self.paged(chipsShown) { chipRow }.padding(.top, IslandMetrics.reviewChipsTop)
        }
        footer.padding(.top, IslandMetrics.sectionGap)
      }
      .padding([.horizontal, .bottom], IslandMetrics.cardPadding)
    }
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

  /// The chrome around the answer (top rows and footer) at ideal width, cached across streaming
  /// chunks while TextKit measures the answer width directly.
  var chromeWidthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      top
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
        .contentTransition(.opacity)
        .animation(.easeOut(duration: Self.fadeIn), value: review.version)
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
      }
      if review.pages > 1 { pager }
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

  /// ‹ page / pages ›, each arrow off at its end; the last page is the pending version's while
  /// one is being made.
  private var pager: some View {
    let labels = model.labels.review
    let side = IslandMetrics.reviewPagerSide
    return HStack(spacing: 0) {
      IslandIconButton(
        glyph: IslandIcons.scrollLeft, label: labels.previous, tooltip: labels.previous + " ⌘←",
        side: side
      ) { model.reviewEvent(.version(review.version - 1)) }
      .disabled(review.version <= 1)
      .opacity(review.version <= 1 ? 0.38 : 1)
      Text(verbatim: "\(review.version) / \(review.pages)")
        .font(IslandType.hint).foregroundStyle(.secondary).monospacedDigit().fixedSize()
        .contentTransition(.numericText(value: Double(review.version)))
        .animation(.snappy(duration: 0.3), value: review.version)
      IslandIconButton(
        glyph: IslandIcons.scrollRight, label: labels.next, tooltip: labels.next + " ⌘→",
        side: side
      ) { model.reviewEvent(.version(review.version + 1)) }
      .disabled(review.version >= review.pages)
      .opacity(review.version >= review.pages ? 0.38 : 1)
    }
  }

  /// The answer, marked or plain, or on the pending version's page a line held for it until any
  /// of it comes; measured it shows at its full height, shown it scrolls in the room the rest
  /// leaves. Each page has a scroll of its own, so another page opens at its top. The room clips
  /// them: a page leaving keeps its size while it fades, and the card around it may already be
  /// shorter, so unclipped its text would stand over the field and the chips below.
  @ViewBuilder private var answerView: some View {
    let text = Group {
      if marksChanges, let changes = review.changes {
        IslandReviewMarkedAnswer(changes: changes)
      } else if streaming, answer.allSatisfy(\.isWhitespace) {
        // The header's spinner says the version is being made.
        Text(verbatim: " ").font(IslandType.answer).accessibilityHidden(true)
      } else {
        IslandAnswerText(text: answer)
      }
    }
    .padding(.vertical, IslandMetrics.sectionGap)
    if height == nil {
      text
    } else {
      Self.paged(review.version) {
        IslandFadingScroll(reduceMotion: model.reduceMotion, follows: streaming) { text }
      }
      .frame(maxHeight: .infinity, alignment: .top)
      .clipped()
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
      .modifier(FloatingHover(pointer: .text) { _ in })
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
    // As the compose card's field: focus once the card is active and has arrived and its window
    // has the keyboard, and again when the window takes it back.
    .onChange(of: active && model.arrived && model.cardIsKey, initial: true) { _, focus in
      fieldFocused = focus
    }
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

  /// How long another version's answer, chips and title take to fade in.
  private static let fadeIn = 0.18

  /// `content` as `shown`, what it shows: when that changes, the last fades out quickly and the
  /// next fades in in its place just after, so the two barely overlap; when it does not (the
  /// chips of two versions that ran with the same values), nothing moves.
  private static func paged(
    _ shown: some Hashable, @ViewBuilder content: () -> some View
  ) -> some View {
    ZStack(alignment: .topLeading) {
      content()
        .id(shown)
        .transition(
          .asymmetric(
            insertion: .opacity.animation(.easeOut(duration: fadeIn).delay(0.06)),
            removal: .opacity.animation(.easeIn(duration: 0.1))))
    }
    .animation(.easeOut(duration: fadeIn), value: shown)
  }

  var chipsShownKey: [String] { chipsShown }

  /// What the chips row shows of the version: values, summary and adjustments, not what the
  /// person staged on them.
  private var chipsShown: [String] {
    review.chipRow.map {
      switch $0 {
      case .value(let key, let option): "\(key)=\(option.value)=\(option.label)"
      case .summary: "summary=" + (review.summary ?? "")
      case .adjustment(let adjustment): "adjust=" + adjustment
      }
    }
  }

  private var footer: IslandResultFooter {
    IslandResultFooter(
      model: model, offer: offer, pending: pending, waits: pending,
      showsOptionHint: !review.chipRow.isEmpty)
  }
}
