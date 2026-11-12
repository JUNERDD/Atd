import AICore
import SwiftUI

/// The floating container of the screenshot text command's result card as
/// ``CaptureResultCardModel`` presents it: one shape of the shell's glass
/// (``View/glassSurface(in:animation:dark:)``) holding the faces ``CaptureResultStage`` mounts,
/// the card itself (``CaptureResultPanel``) or the copied capsule (``IslandStatusCapsule``), which
/// morph into each other; nothing while hidden. The
/// host places each where ``CaptureResultPlacement`` puts it, at ``CaptureResultCardModel/size``
/// or cut shorter (the card then fills the room it has, its body scrolling), in a window that
/// reports hover regions (``FloatingHoverHost``) so its controls light and set the pointer as the
/// island's do. The lightbox's side panel shows the same content pieces (the note,
/// ``CaptureResultBody``, the review's pager and controls, ``CaptureResultFooter``) in its own
/// container.
struct CaptureResultCardView: View {
  let model: CaptureResultCardModel
  let stage: CaptureResultStage

  var body: some View {
    let shape = stage.shape
    ZStack(alignment: .topLeading) {
      ForEach(stage.faces) { face in
        CaptureResultFaceView(model: model, face: face, shape: shape, animation: stage.animation)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .glassSurface(
      in: MiniPanelGlassOutline(shape: shape), animation: stage.animation, dark: model.dark
    )
    .backport.glassEffectTransition(.identity)
    .backport.glassEffectContainer()
    // Outside the container, so the glass fades with its faces as the stage enters and leaves.
    .animation(stage.fade) { $0.opacity(stage.opacity) }
  }
}

/// One face where it rests, following the shape as drawn (``MiniPanelFollowEffect``, at its own
/// size under Reduce Motion) and arriving or leaving on its presence, as the island's layers do
/// (``IslandView``); a face that is not shown takes no pointer and no VoiceOver focus.
private struct CaptureResultFaceView: View {
  let model: CaptureResultCardModel
  let face: CaptureResultFace
  let shape: MiniPanelGlassRect
  let animation: Animation?

  var body: some View {
    let shown = face.presence.shown
    let rest = face.rest
    content
      .environment(\.floatingHoverActive, shown)
      .frame(width: rest.width, height: rest.height, alignment: .topLeading)
      .animation(animation) {
        $0.modifier(
          MiniPanelFollowEffect(shape: shape, rest: rest, scales: !model.reduceMotion)
            .ignoredByLayout())
      }
      .animation(nil) { $0.offset(x: rest.minX, y: rest.minY) }
      .modifier(MiniPanelPresenceEffect(presence: face.presence))
      .allowsHitTesting(shown)
      .accessibilityHidden(!shown)
  }

  @ViewBuilder private var content: some View {
    switch face.kind {
    case .card:
      if let card = model.card {
        CaptureResultPanel(model: model, card: card, height: face.rest.height)
      }
    case .copied(let text):
      IslandStatusCapsule(text: text, running: false).frame(height: IslandMetrics.capsuleHeight)
    }
  }
}

/// The card, built as the island's answer card is (``IslandAnswerCard``): the grabber strip that
/// moves it, the command's name and close (with the versions and Regenerate once the run has
/// versions), a note on what it read and where the result went, the body (``CaptureResultBody``),
/// the versions' chips and adjust field, and one footer row of key hints and actions
/// (``CaptureResultFooter``), resting while the run produces. The command's name, the answer and
/// recognized text are user data, shown untranslated.
///
/// `height` nil lays the card out with its body at full height, unscrolled, which is how
/// ``CaptureResultMeasure`` measures it; otherwise the body scrolls in the room the rest leaves,
/// fading at an edge with more past it.
struct CaptureResultPanel: View {
  let model: CaptureResultCardModel
  let card: CaptureResultCard
  var height: CGFloat?

  private var labels: CaptureResultLabels { model.labels }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      CaptureResultGrabber(model: model)
      VStack(alignment: .leading, spacing: 0) {
        header
        CaptureResultNote(text: labels.note(card), busy: card.busy)
        content
        if let versions = card.versions {
          CaptureResultReviewControls(model: model, review: versions)
        }
        footer
      }
      .padding([.horizontal, .bottom], IslandMetrics.cardPadding)
    }
    .frame(width: CaptureResultPlacement.cardWidth, height: height, alignment: .topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: card.title))
  }

  /// The body of the page shown; scrolling, it keeps a streaming page's newest content in view and
  /// starts each page at its top (``CaptureResultPageTop``).
  @ViewBuilder private var content: some View {
    if model.shownBody(card) != .none {
      let body = CaptureResultBody(model: model, card: card, measuring: height == nil)
        .padding(.vertical, IslandMetrics.sectionGap)
      if height == nil {
        body
      } else {
        ScrollViewReader { proxy in
          IslandFadingScroll(reduceMotion: model.reduceMotion, follows: model.follows(card)) {
            body.modifier(
              CaptureResultPageTop(
                page: model.page(card), follows: model.follows(card), proxy: proxy))
          }
        }
        .frame(maxHeight: .infinity, alignment: .top)
      }
    }
  }

  /// The title row, whose × does what closing does: under review it discards the version shown;
  /// otherwise it lets the card go, its results staying on the image.
  private var header: some View {
    IslandResultHeader(
      title: card.title,
      close: card.reviewing ? labels.discard : labels.island.close,
      accessory: {
        if let versions = card.versions {
          CaptureResultReviewPager(model: model, review: versions)
        }
      },
      onClose: { card.reviewing ? model.discard() : model.close() })
  }

  private var footer: some View {
    CaptureResultFooter(model: model, card: card, hints: card.hints)
  }
}

/// The card's grabber: the island's (``IslandGrabberMark``), lit while hovered or dragged, under
/// the open hand and the closed one while it drags. It moves nothing itself: it tells the host how
/// far the drag has gone (``CaptureResultAction/move(_:)``) and when it ends, and the host moves
/// the card, keeping it in its area.
private struct CaptureResultGrabber: View {
  let model: CaptureResultCardModel
  @State private var hovered = false
  @State private var dragging = false

  var body: some View {
    IslandGrabberMark(highlighted: hovered || dragging)
      .contentShape(Rectangle())
      .modifier(FloatingHover(pointer: dragging ? .grabbing : .grab) { hovered = $0 })
      .help(model.labels.island.move)
      .gesture(
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
          .onChanged { value in
            dragging = true
            model.onAction(.move(value.translation))
          }
          .onEnded { _ in end() }
      )
      .onDisappear { end() }
      .frame(maxWidth: .infinity)
      .accessibilityHidden(true)
  }

  private func end() {
    guard dragging else { return }
    dragging = false
    model.onAction(.moveEnded)
  }
}

/// The note under the title, in the hint type, wrapping to two lines, with a spinner while the
/// run produces (``IslandAnswerNote``'s look).
struct CaptureResultNote: View {
  let text: String
  let busy: Bool

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      if busy { IslandSpinner(side: 10).alignmentGuide(.firstTextBaseline) { $0.height - 1 } }
      Text(verbatim: text)
        .font(IslandType.hint)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(IslandMetrics.maxNoteLines)
        .truncationMode(.tail)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
    .padding(.bottom, IslandMetrics.noteGap)
    .frame(maxWidth: .infinity, alignment: .leading)
    .help(text)
    .accessibilityElement(children: .combine)
  }
}
