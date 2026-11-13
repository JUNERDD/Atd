import AICore
import SwiftUI

/// The header's tools beside the title once the run has versions (under review or not): ‹ page /
/// pages › once there are several, each arrow off at its end, and Regenerate, resting while a
/// version is being made or once the run has as many as it may make. While a version is being
/// made it is the newest page, which the card turns to as it begins, and the arrows still page
/// back to the versions made and forward to it (``CaptureResultCardModel/version(_:)``).
struct CaptureResultReviewPager: View {
  let model: CaptureResultCardModel
  let review: CaptureResultCard.Versions

  var body: some View {
    let labels = model.labels.island.review
    let side = IslandMetrics.reviewPagerSide
    let full = review.full
    let page = model.page(of: review)
    let pages = review.pages
    HStack(spacing: IslandMetrics.gap) {
      if pages > 1 {
        HStack(spacing: 0) {
          IslandIconButton(
            glyph: IslandIcons.scrollLeft, label: labels.previous, tooltip: labels.previous,
            side: side
          ) { model.version(page - 1) }
          .disabled(page <= 1)
          .opacity(page <= 1 ? 0.38 : 1)
          Text(verbatim: "\(page) / \(pages)")
            .font(IslandType.hint).foregroundStyle(.secondary).monospacedDigit().fixedSize()
          IslandIconButton(
            glyph: IslandIcons.scrollRight, label: labels.next, tooltip: labels.next, side: side
          ) { model.version(page + 1) }
          .disabled(page >= pages)
          .opacity(page >= pages ? 0.38 : 1)
        }
      }
      IslandIconButton(
        glyph: IslandIcons.regenerate, label: labels.regenerate,
        tooltip: full ? labels.limit : labels.regenerate
      ) { model.regenerate() }
      .disabled(review.pending || full)
      .opacity(review.pending || full ? 0.38 : 1)
    }
  }
}

/// The adjust field with its send button, then the command's suggested adjustments as chips, each
/// chosen or not, in the island review card's order (``IslandReviewCard``), once the run has
/// versions: the field's text and the chosen adjustments go to the page together as one
/// adjustment (``CaptureResultCardModel/sendAdjustment()``), from the button or Return. Both rest
/// while a version is being made or the run has as many versions as it may make.
struct CaptureResultReviewControls: View {
  @Bindable var model: CaptureResultCardModel
  let review: CaptureResultCard.Versions

  var body: some View {
    let labels = model.labels.island.review
    let full = review.full
    let ready = model.review.canSend && !review.pending && !full
    let draft = model.review
    let placeholder =
      full
      ? labels.limit
      : draft.count > 0 && draft.text.isEmpty ? labels.staged(draft.count) : labels.placeholder
    VStack(alignment: .leading, spacing: IslandMetrics.reviewChipsTop) {
      HStack(spacing: 6) {
        TextField(text: $model.review.text, prompt: Text(verbatim: placeholder)) {
          Text(verbatim: labels.placeholder)
        }
        .textFieldStyle(.plain)
        .font(IslandType.answer)
        .lineLimit(1)
        .onSubmit { model.sendAdjustment() }
        .modifier(FloatingHover(pointer: .text) { _ in })
        IslandReviewSendButton(
          ready: ready, label: labels.send, tooltip: full ? labels.limit : nil
        ) { model.sendAdjustment() }
      }
      .padding(.leading, 10)
      .padding(.trailing, 4)
      .frame(height: IslandMetrics.reviewFieldHeight)
      .background { IslandWash(level: 0.07, shape: Capsule()) }
      .padding(.horizontal, 2)
      if !review.adjustments.isEmpty {
        IslandChipFlow {
          ForEach(review.adjustments, id: \.self) { adjustment in
            IslandReviewChip(title: adjustment, selected: draft.chose(adjustment)) {
              model.review.toggle(adjustment: adjustment)
            }
          }
        }
        .padding(.horizontal, 4)
      }
    }
    .disabled(review.pending)
    .padding(.top, IslandMetrics.sectionGap)
  }
}
