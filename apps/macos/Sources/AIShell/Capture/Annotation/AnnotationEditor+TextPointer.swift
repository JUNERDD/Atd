import AICore
import AppKit

/// The editor's hold on a canvas's pointer ahead of the annotation interaction
/// (``AnnotationCanvasPointer``): text mode's presses, drags and hover, a click on a step badge a
/// text command drew (which opens its result card with the item lit), a click in text mode on the
/// result of a run with versions (which opens its card as well as picking), and the originals
/// behind translations, shown while ⌥ is held or the pointer rests on one (decision D2: they are
/// hidden from the drawing only, never from the export). With a tool chosen the annotations are
/// edited like any other, so none of this applies.
extension AnnotationEditor: AnnotationCanvasPointer {
  func takesPress(at point: CGPoint) -> Bool {
    guard interaction.tool == nil else { return false }
    return text.mode.isOn || stepBadge(at: point) != nil
  }

  func pressDown(at point: CGPoint, flags: NSEvent.ModifierFlags, clicks: Int) {
    if let badge = stepBadge(at: point) {
      text.badgePress = badge
      return
    }
    text.badgePress = nil
    text.mode.pressDown(at: point, flags: flags, clicks: clicks)
    refresh()
  }

  func pressDragged(to point: CGPoint) {
    guard text.badgePress == nil else { return }
    text.mode.dragged(to: point)
    refreshSlot()
    refreshTextLayers()
  }

  func pressUp(at point: CGPoint) {
    if let badge = text.badgePress {
      text.badgePress = nil
      if stepBadge(at: point)?.run == badge.run { openCard(of: badge.run, lighting: badge.item) }
      return
    }
    // A plain click (no drag, no ⌘ or ⇧) on a run's result also opens its card, while nothing is
    // producing.
    if let click = text.mode.released(), !click.adding,
      let run = text.runs.reopening(at: point, in: store.document)
    {
      openCard(of: run.id)
    }
    refresh()
  }

  func pointerMoved(to point: CGPoint?) {
    if text.mode.isOn, text.mode.hover(point) { refreshTextLayers() }
    // A badge of the run the card shows lights its item there, as hovering the item lights it.
    let shown = text.card.card?.run
    let hot = point.flatMap(stepBadge(at:)).flatMap { $0.run == shown ? $0.item : nil }
    if hot != text.imageHot {
      text.imageHot = hot
      text.card.hotItem = hot
      refreshTextLayers()
    }
    let peeked = interaction.tool == nil ? point.map(translation(at:)) ?? [] : []
    guard peeked != text.peeked else { return }
    text.peeked = peeked
    refreshOriginals()
  }

  func cursor(at point: CGPoint) -> NSCursor? { textCursor(at: point) }

  func optionChanged(_ down: Bool) {
    let shows = down && interaction.tool == nil
    guard shows != text.showsOriginals else { return }
    text.showsOriginals = shows
    refreshOriginals()
  }

  // MARK: AI marks on the image

  /// The step badge a text command drew under `point`, front-most, as its run and item.
  func stepBadge(at point: CGPoint) -> (run: String, item: Int)? {
    guard !text.runs.runs.isEmpty, let id = store.document.hit(at: point, tolerance: 2),
      case .step = store.document[id]?.shape
    else { return nil }
    for run in text.runs.runs.reversed() {
      for (item, ids) in run.applied
      where ids.contains(id) && run.items.indices.contains(item) && run.items[item].tool == .step {
        return (run.id, item)
      }
    }
    return nil
  }

  /// The annotations of the translation under `point`: one replaced paragraph's.
  private func translation(at point: CGPoint) -> Set<UUID> {
    for run in text.runs.runs.reversed() {
      for (item, ids) in run.applied
      where run.items.indices.contains(item) && run.items[item].tool == .replace {
        if ids.contains(where: { store.document[$0]?.bounds.contains(point) == true }) {
          return Set(ids)
        }
      }
    }
    return []
  }

  /// Every translation's annotations, which ⌥ hides.
  private var translations: Set<UUID> {
    Set(
      text.runs.runs.flatMap { run in
        run.applied.filter {
          run.items.indices.contains($0.key) && run.items[$0.key].tool == .replace
        }
        .values.joined()
      })
  }

  /// Hides from every canvas's drawing the translations whose originals show, those a review
  /// previews included.
  func refreshOriginals() {
    let previewed = text.preview.preview?.replacements ?? []
    let hidden =
      interaction.tool == nil
      ? (text.showsOriginals ? translations.union(previewed) : text.peeked) : []
    for canvas in canvases { canvas.hiddenAnnotations = hidden }
  }

  /// Opens run `runID`'s card with item `item` lit: the card shown opens again, or another run's
  /// replaces it (decision D8, one card at a time).
  func openCard(of runID: String, lighting item: Int? = nil) {
    guard let run = text.runs[runID] else { return }
    text.card.reopen(card(for: run), lighting: item)
    refreshTextLayers()
    placeCard()
  }
}
