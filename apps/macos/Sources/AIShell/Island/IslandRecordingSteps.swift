import AICore
import SwiftUI

/// "Steps Atd will read" beside the card's player (R9), and in its lightbox's side panel: every
/// click, key, app switch, screen change and line of narration by time, as tall as its place
/// (the player, the panel) and scrolling inside past it. The step at the playhead is marked (and
/// kept in view while playing); hovering one shows its frame in the player and marks its dot on
/// the strip; a click goes there; a step outside the kept range is dimmed, since Atd will not
/// read it. Its title's info glyph says what Atd reads instead of a footnote, and "No narration"
/// says the microphone was off. Both places draw the one card model, so they mark the same
/// steps; the panel brings its own title row and scroll (``IslandRecordingStepsPanel``).
struct IslandRecordingSteps: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let reduceMotion: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      header
      if card.source.steps.isEmpty {
        IslandRecordingNoSteps(labels: labels)
      } else {
        ScrollViewReader { proxy in
          ScrollView(.vertical) {
            IslandRecordingStepRows(card: card, labels: labels, proxy: proxy)
          }
          .modifier(FloatingScrollEdges(reduceMotion: reduceMotion))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.steps))
  }

  private var header: some View {
    HStack(spacing: 4) {
      Text(verbatim: labels.steps).lineLimit(1)
      IslandGlyph(name: IslandIcons.reads, side: 13)
        .help(labels.stepsInfo)
        .accessibilityHidden(false)
        .accessibilityLabel(Text(verbatim: labels.stepsInfo))
      Spacer(minLength: 0)
      if !card.source.narration {
        IslandRecordingNoNarration(labels: labels)
          .padding(.trailing, IslandMetrics.rowPadding)
      }
    }
    .font(IslandType.hint)
    .foregroundStyle(.secondary)
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.recordingStepsHeader)
  }
}

/// The steps in the lightbox's side panel (``IslandLightboxPanel``): its title row says "Steps
/// Atd will read" with the info glyph, and "No narration" among its tools, over the steps.
struct IslandRecordingStepsPanel: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let reduceMotion: Bool
  let onHide: () -> Void

  var body: some View {
    IslandLightboxPanel(
      title: labels.steps, info: (IslandIcons.reads, labels.stepsInfo),
      hide: labels.lightboxHidePanel, reduceMotion: reduceMotion, onHide: onHide,
      tools: {
        if !card.source.narration {
          IslandRecordingNoNarration(labels: labels).font(IslandType.hint)
        }
      },
      content: { proxy in
        if card.source.steps.isEmpty {
          IslandRecordingNoSteps(labels: labels)
        } else {
          IslandRecordingStepRows(card: card, labels: labels, proxy: proxy)
        }
      })
  }
}

/// The steps, one row each, in a scroll view whose `proxy` keeps the playhead's in view while it
/// plays.
private struct IslandRecordingStepRows: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let proxy: ScrollViewProxy

  var body: some View {
    LazyVStack(spacing: IslandMetrics.recordingStepGap) {
      ForEach(card.source.steps.indices, id: \.self) { index in
        IslandRecordingStepRow(card: card, labels: labels, index: index).id(index)
      }
    }
    .onChange(of: card.currentStep) { _, step in
      guard card.playing, let step else { return }
      withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(step, anchor: .center) }
    }
  }
}

/// What shows in place of the steps when the recording has none.
private struct IslandRecordingNoSteps: View {
  let labels: IslandRecordingLabels

  var body: some View {
    Text(verbatim: labels.noSteps)
      .font(IslandType.hint)
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, IslandMetrics.rowPadding)
      .padding(.vertical, 6)
  }
}

/// "No narration", when the microphone was off; its tooltip says so.
private struct IslandRecordingNoNarration: View {
  let labels: IslandRecordingLabels

  var body: some View {
    Text(verbatim: labels.noNarration)
      .foregroundStyle(.tertiary)
      .lineLimit(1)
      .help(labels.noNarrationTooltip)
  }
}

/// One step: its time, its kind's glyph and its text, cut with an ellipsis (the tooltip has it
/// whole).
private struct IslandRecordingStepRow: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let index: Int

  var body: some View {
    let step = card.source.steps[index]
    let kept = card.state.keeps(step: index)
    let now = card.currentStep == index
    let hot = card.hoveredStep == index
    let time = RecordingClock.text(step.time)
    let text = step.kind == .narration ? "“" + step.text + "”" : step.text
    HStack(spacing: 8) {
      IslandStableText(text: time, reserve: [RecordingClock.reserved(for: card.source.duration)])
        .font(IslandType.hint)
        .monospacedDigit()
        .foregroundStyle(
          kept
            ? (now ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary)) : AnyShapeStyle(.tertiary)
        )
      IslandGlyph(name: Self.glyph(step.kind), side: 14)
        .foregroundStyle(kept ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary))
      Text(verbatim: text)
        .font(.system(size: 13))
        .foregroundStyle(
          !kept
            ? AnyShapeStyle(.tertiary)
            : step.kind == .narration ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
        )
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.recordingStepHeight)
    .background {
      IslandWash(
        level: now ? 0.1 : hot ? 0.06 : 0,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.rowRadius, style: .continuous))
    }
    .contentShape(Rectangle())
    .modifier(FloatingHover { card.hover(step: index, $0) })
    .onTapGesture { card.seek(step.time) }
    .help(kept ? time + " " + text : labels.stepOutside)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: time + " " + text))
    .accessibilityAddTraits(now ? [.isButton, .isSelected] : .isButton)
    .accessibilityAction { card.seek(step.time) }
  }

  /// The kind's Lucide glyph.
  static func glyph(_ kind: RecordingCardStep.Kind) -> String {
    switch kind {
    case .click: "mouse-pointer-click"
    case .key: "keyboard"
    case .app: "app-window"
    case .change: "square-text"
    case .narration: "message-square"
    }
  }
}
