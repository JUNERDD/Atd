import AICore
import SwiftUI

/// A shell card's one answer slot (R10, `record-answer.js`), under the ask field: the shown
/// page's title (what was asked, or that it is being answered), the range it was asked about
/// (``rangeText``: the recording's times, the long screenshot's kept height), then Stop while it
/// comes, or the pager `‹ n / m ›`, Regenerate, Copy and Open in Atd once it has. Its text grows
/// only while the card is open (``IslandAsking/answerFloor``, up to the cap, scrolling inside
/// past it), so paging and thinking never move the pager or the field above it; with ``seek``, a
/// time named on its own in the text is a link that seeks the player there. An ask that paged to
/// its earlier answer flashes the slot.
struct IslandAskAnswerSlot<Ask: CardAsk, Quick: IslandQuickAsk>: View {
  let model: IslandModel
  let asking: IslandAsking<Ask, Quick>
  let labels: IslandAskLabels<Quick>
  let height: Double
  let rangeText: (Ask.Range) -> String
  var seek: ((Double) -> Void)?
  @State private var flash = 0.0

  var body: some View {
    // Keep the section's allocation even while its page is inserted or removed. Its full
    // extent follows the same presentation clock as the card, not just the text viewport.
    ZStack(alignment: .top) { content }
      .frame(height: height, alignment: .top)
      .clipped()
  }

  @ViewBuilder private var content: some View {
    if let answer = asking.answers.shown {
      VStack(alignment: .leading, spacing: 0) {
        Divider()
          .frame(height: IslandMetrics.recordingAnswerRule)
          .padding(.bottom, IslandMetrics.recordingAnswerTop)
        header(answer)
        answerBody(answer)
          .frame(maxWidth: .infinity, alignment: .leading)
          .frame(
            height: max(height - IslandMetrics.recordingAnswerSlot(text: 0), 0), alignment: .top)
      }
      .background {
        IslandWash(
          level: flash,
          shape: UnevenRoundedRectangle(
            bottomLeadingRadius: IslandMetrics.rowRadius,
            bottomTrailingRadius: IslandMetrics.rowRadius, style: .continuous))
      }
      .padding(.top, IslandMetrics.recordingSectionGap)
      .onChange(of: asking.answers.flash) {
        flash = 0.16
        withAnimation(.easeOut(duration: 0.7)) { flash = 0 }
      }
      .accessibilityElement(children: .contain)
    }
  }

  @ViewBuilder private func answerBody(_ answer: CardAnswer<Ask.Range, Quick>) -> some View {
    let text = IslandAskAnswerText(answer: answer, labels: labels, seek: seek)
    if text.isEmpty {
      // Keep the measured height floor without a padding-sized native scroll view. Its corner
      // can paint even with no text or visible scroller while the answer is still thinking.
      Color.clear
    } else {
      IslandFadingScroll(reduceMotion: model.reduceMotion) {
        text
          .padding(.leading, IslandMetrics.recordingAnswerIndent)
          .padding(.trailing, IslandMetrics.rowPadding)
          .padding(.top, IslandMetrics.recordingAnswerTextTop)
          .padding(.bottom, IslandMetrics.recordingAnswerTextBottom)
      }
    }
  }

  private func header(_ answer: CardAnswer<Ask.Range, Quick>) -> some View {
    let quick = answer.quick.map(labels.question)
    let title =
      answer.phase == .thinking
      ? labels.running(quick) : quick ?? labels.question(answer.question)
    return HStack(spacing: IslandMetrics.gap) {
      HStack(spacing: 8) {
        if answer.phase == .thinking {
          IslandSpinner()
        } else {
          IslandGlyph(name: IslandIcons.sparkles, side: 14).foregroundStyle(.secondary)
        }
        titleText(title, shimmering: answer.phase == .thinking)
      }
      Text(verbatim: rangeText(answer.range))
        .font(IslandType.hint)
        .monospacedDigit()
        .foregroundStyle(.tertiary)
        .lineLimit(1)
        .fixedSize()
        .padding(.leading, 8)
        .help(labels.rangeTooltip)
      Spacer(minLength: 4)
      if answer.phase.running {
        IslandIconButton(
          glyph: IslandIcons.close, label: labels.stop, tooltip: labels.stop + " Esc"
        ) { asking.stopAnswer() }
      } else {
        HStack(spacing: IslandMetrics.gap) { tools }
          .fixedSize()
      }
    }
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.recordingAnswerHeader)
  }

  @ViewBuilder private func titleText(_ title: String, shimmering: Bool) -> some View {
    let width = IslandType.width(of: title, weight: .semibold, limit: 220)
    if shimmering {
      IslandShimmer(text: title)
        .frame(minWidth: 0, maxWidth: IslandShimmer.width(of: title, limit: 220))
    } else {
      Text(verbatim: title)
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(minWidth: 0, maxWidth: width, alignment: .leading)
        .help(title)
    }
  }

  @ViewBuilder private var tools: some View {
    let answers = asking.answers
    if answers.pages.count > 1, let current = answers.current {
      HStack(spacing: 0) {
        IslandIconButton(glyph: IslandIcons.scrollLeft, label: labels.previousAnswer) {
          asking.page(by: -1)
        }
        .disabled(current == 0)
        .opacity(current == 0 ? 0.38 : 1)
        Text(verbatim: "\(current + 1) / \(answers.pages.count)")
          .font(IslandType.hint)
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .frame(minWidth: 40)
        IslandIconButton(glyph: IslandIcons.scrollRight, label: labels.nextAnswer) {
          asking.page(by: 1)
        }
        .disabled(current == answers.pages.count - 1)
        .opacity(current == answers.pages.count - 1 ? 0.38 : 1)
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(verbatim: labels.pager(current + 1, of: answers.pages.count)))
      IslandRule()
    }
    IslandIconButton(glyph: IslandIcons.regenerate, label: labels.regenerate) {
      asking.regenerate()
    }
    IslandIconButton(
      glyph: asking.copiedAnswer ? "check" : IslandIcons.copy,
      label: asking.copiedAnswer ? model.labels.copied : labels.copyAnswer,
      foreground: asking.copiedAnswer ? .accentColor : .primary
    ) { asking.copyAnswer() }
    IslandTextButton(
      title: model.labels.openInAtd, tooltip: labels.openTooltip, glyph: "arrow-up-right"
    ) {
      asking.openAnswer()
    }
  }
}
