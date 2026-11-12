import AICore
import AppKit
import SwiftUI

/// Runs the command island (the "Dynamic Island" of a command that runs without the panel): one
/// glass shape at the bottom of the screen that enters as the Dynamic Island opens, out of a pill
/// on its bottom edge on elastic per-axis springs, morphs from content to content as the mini
/// panel's body does, and leaves as one piece, its content shrinking a little with the shape as it
/// fades (``IslandChoreography``). Each change sets the shape and the contents' presence
/// once, with the animation each moves on, and SwiftUI runs them; nothing is written while
/// anything moves. Content leaves before the shape moves and arrives after it, and a card's field
/// takes the keyboard once the shape has come to rest (``shapeMoves(settling:)``). The window's
/// alpha carries the fades, so the glass fades with its content.
///
/// Placement is the glass HUDs' (``GlassHUDPlacement``): every appearance starts at home, the
/// bottom centre of the display under the pointer; its move handles (``IslandMoveHandle``) drag
/// it within the work area, and a double-click puts it back. Shapes stand on the same bottom edge
/// (``IslandMetrics/rest(_:)``), so the card grows up out of the capsule. The window is the
/// default canvas for commands. Recording reserves its display's work area before appearing,
/// keeping the window and coordinate system fixed throughout playback and as answers grow.
///
/// The owner decides what shows (``show(_:inPlace:)``, ``exit()``) and when the window may take the
/// keyboard (``setKeyCapable(_:taking:)``, the options card and the answer card).
final class IslandController: NSObject, NSWindowDelegate {
  let model = IslandModel()
  /// The island came onto the screen (true) or left it (false, once its fade finished).
  var onVisibilityChange: ((Bool) -> Void)?
  /// A key press while a card has the keyboard: true when it was taken.
  var onKeyDown: ((NSEvent) -> Bool)?
  /// A key equivalent while a card has the keyboard, ahead of the window's views and the menus:
  /// true when it was taken.
  var onKeyEquivalent: ((NSEvent) -> Bool)?
  /// A scroll over the island: true when it was taken.
  var onScroll: ((NSEvent) -> Bool)?
  /// The window gave up the keyboard.
  var onResignKey: (() -> Void)?

  lazy var window = makeWindow()
  /// What shows, or arrives; nil while nothing does or the island leaves.
  private(set) var content: IslandContent?
  /// The shape's size at rest.
  var size: WindowSize?
  /// The shape's bottom centre at rest, in global coordinates (y up).
  var anchor: NSPoint?
  /// When every motion of the shape still running has come to rest (``shapeMoves(settling:)``).
  var shapeRests = 0.0
  /// The content that shows now, by layer id.
  private var activeLayer: Int?
  private var nextLayer = 0
  /// Bumped by every show and hide, so an exit still fading never hides a later show.
  private var generation = 0
  /// The island is shrinking and fading out; a show before it is gone turns it back.
  private var exiting = false
  private var reportedVisible = false
  var dragStart: (mouse: NSPoint, anchor: NSPoint)?
  /// The compose card's width and note height as last measured (``measureCompose``).
  var composeMeasures = ComposeMeasureCache()
  private var observers: [NSObjectProtocol] = []
  /// Takes the keyboard once a shortcut's modifiers are up (``setKeyCapable(_:taking:)``).
  let keyboardTake = KeyboardHandoff()

  override init() {
    super.init()
    model.labels = .current()
    model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    model.drag = { [weak self] in self?.drag($0) }
    observers = [
      NotificationCenter.default.addObserver(
        forName: ShellStrings.didChange, object: nil, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.languageChanged() } },
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        }
      },
    ]
  }

  /// Shows `next`: entering when nothing shows, changed in place when the same kind shows (a
  /// summary arriving, the language, another version of a review), else morphed into from what
  /// shows. `inPlace` keeps content at its own size without bounce for direct edits;
  /// asynchronous updates retain the spring.
  func show(_ next: IslandContent, inPlace: Bool = false) {
    if next.kind.layoutMotion == .interpolated { model.layoutMotion = .interpolated }
    let target = measure(next)
    generation += 1
    growCanvas(for: next.kind.isShell ? screenRoom() : target.size)
    if !window.isVisible {
      appear(next, size: target)
    } else if exiting {
      turnBack(next, size: target)
    } else if let content, content.kind == next.kind {
      update(next, size: target, inPlace: inPlace)
    } else {
      replace(next, size: target, leavingCard: model.card)
    }
    content = next
  }

  /// The options card changed: a new page replaces the old one through a morph; on the same
  /// page the rows change in place, in a card whose size the page fixed.
  func updateCard(_ card: OptionsCard) {
    let previous = model.card
    model.card = card
    guard let content, case .choose = content, !exiting, previous?.page != card.page else {
      return
    }
    replace(content, size: measure(content), leavingCard: previous)
  }

  /// The island leaves as one piece: its content stays in the glass and follows the shape as it
  /// shrinks a little, to ``SelectionToolbarEntrance/startScale``, toward its bottom edge while
  /// the window fades out, eased in over ``IslandChoreography/exitDuration``. The
  /// content never goes first, so the glass never shows empty. Departing controls take no
  /// pointer input; transparent pixels still pass it through. Under Reduce Motion it only fades.
  func exit() {
    keyboardTake.cancel()
    guard window.isVisible, !exiting else { return }
    exiting = true
    generation += 1
    let token = generation
    window.acceptsPointerEvents = false
    for index in model.layers.indices { model.layers[index].followsShape() }
    let duration = IslandChoreography.exitDuration
    if !model.reduceMotion {
      model.shape = model.shape.scaled(
        SelectionToolbarEntrance.startScale, animation: .easeIn(duration: duration))
    }
    fade(to: 0, duration: duration, timing: .easeIn) { [weak self] in
      guard let self, token == generation else { return }
      finish()
    }
  }

  /// A show before the exit finished turns it back: the window fades in again from where the
  /// fade has it, and the shape, its content still in it, springs from where it is to `next`'s,
  /// changing the content in place for the same kind and morphing into it otherwise.
  private func turnBack(_ next: IslandContent, size measured: IslandMeasure) {
    exiting = false
    window.acceptsPointerEvents = true
    for index in model.layers.indices { model.layers[index].followsShape() }
    let entrance = SelectionToolbarEntrance.self
    fade(
      to: 1, duration: model.reduceMotion ? entrance.reducedMotionFade : entrance.fadeDuration,
      timing: .easeOut)
    guard let content, content.kind == next.kind else {
      return replace(next, size: measured, leavingCard: model.card)
    }
    update(next, size: measured)
    morph(to: measured.size, motion: motion(to: measured.size), card: next.kind.isCard)
  }

  /// Leaves the screen at once.
  func hide() {
    generation += 1
    guard window.isVisible else { return }
    finish()
  }

  /// The text field typing into the card, while it has the keyboard.
  var editingField: NSTextView? { window.editingField }

  // MARK: Choreography

  /// Enters as the Dynamic Island opens, shape and content together: the shape opens out of a pill
  /// standing on the middle of its bottom edge (``IslandShape/entrancePill``) to its first
  /// content's measured size, its height and its width each on its own elastic spring
  /// (``IslandChoreography/entrance(reduceMotion:)``), swelling a little past their rest before
  /// they settle, as the window fades in and the content arrives (``IslandChoreography/entering``:
  /// no delay), small in the pill and growing with it as its blur clears. It arrives, and a
  /// card's field takes the keyboard, once both springs have come to rest
  /// (``morph(to:motion:card:)``). Under Reduce Motion the shape stands at its size, and window
  /// and content only fade.
  ///
  /// The window shows nothing until that start is drawn: it is ordered in at alpha 0 with a
  /// fresh view tree (``IslandModel/appearance``), so neither the previous island's last frame
  /// nor any animation still running from it can show, and laid out and drawn before the fade
  /// and the springs begin a frame later. The fade belongs to the window's entrance, not to its
  /// first content: a show within that frame replaces the content, and the window still fades in.
  private func appear(_ next: IslandContent, size measured: IslandMeasure) {
    let target = measured.size
    exiting = false
    window.acceptsPointerEvents = true
    anchor = clamped(home(target), size: target)
    placeWindow()
    // A fresh view tree: no motion from the last island runs on into this one.
    model.appearance += 1
    shapeRests = 0
    model.layers = []
    let entrance = SelectionToolbarEntrance.self
    let rest = IslandShape(
      frame: IslandMetrics.rest(target),
      corner: IslandMetrics.corner(target, card: next.kind.isCard))
    model.shape = model.reduceMotion ? rest : rest.entrancePill
    size = target
    let id = mount(next, measured)
    window.alphaValue = 0
    window.orderFrontRegardless()
    window.contentView?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    report(true)
    let entering = model.appearance
    after(MiniPanelMotion.frame) { [weak self] in
      guard let self, model.appearance == entering, window.isVisible, !exiting else { return }
      if model.reduceMotion {
        fade(to: 1, duration: entrance.reducedMotionFade, timing: .easeInEaseOut)
      } else {
        fade(to: 1, duration: entrance.fadeDuration, timing: .easeOut)
      }
      // A replace meanwhile reveals its own content on the shape it morphs to.
      guard activeLayer == id else { return }
      reveal(id, IslandChoreography.entering)
      guard let size else { return shapeMoves(settling: 0) }
      // A change in place meanwhile may have moved the rest; the shape opens to where it is.
      // Under Reduce Motion it already stands there, and nothing moves.
      morph(
        to: size, motion: IslandChoreography.entrance(reduceMotion: model.reduceMotion),
        card: content?.kind.isCard == true)
    }
  }

  /// What shows leaves; `next` arrives once it has, as the shape morphs.
  private func replace(
    _ next: IslandContent, size measured: IslandMeasure, leavingCard: OptionsCard?
  ) {
    let target = measured.size
    let leaving = Set(model.layers.map(\.id))
    conceal(leavingCard: leavingCard)
    let id = mount(next, measured)
    // Prepare the hidden content before starting the morph, as appear does. In particular,
    // the recording's native player and text field must not first lay out during the spring.
    window.contentView?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    morph(to: target, motion: motion(to: target), card: next.kind.isCard)
    after(MiniPanelMotion.frame) { [weak self] in
      guard let self, activeLayer == id else { return }
      reveal(id, IslandChoreography.replacing)
    }
    after(MiniPanelMotion.frame + IslandChoreography.unmountDelay) { [weak self] in
      self?.model.layers.removeAll { leaving.contains($0.id) }
    }
  }

  /// The same kind of content changes in place; the shape follows a change of size, on the
  /// expand springs. Direct edits (including the compose card's typing and attachments) keep
  /// content at its own size without bounce. A write offer arriving asynchronously must keep
  /// scaling with the shape, including when it retargets an entrance still in flight.
  private func update(_ next: IslandContent, size measured: IslandMeasure, inPlace: Bool = false) {
    let target = measured.size
    guard let index = model.layers.firstIndex(where: { $0.id == activeLayer }) else {
      return replace(next, size: measured, leavingCard: model.card)
    }
    model.layers[index].content = next
    model.layers[index].limits = measured.limits
    model.layers[index].answerOffer = model.answerOffer
    model.layers[index].shellCard = model.shellCard(for: next)
    guard target != size else { return }
    model.layers[index].rest = IslandMetrics.rest(target)
    // An arrived review card lays out at its shape as drawn, on the direct edits' spring: its
    // title stays on the top edge, its field and footer on the bottom, its answer takes the rest.
    let reflows = next.kind == .review && model.arrived
    let inPlace = inPlace || next.resizesInPlace || reflows
    model.layers[index].scales = !inPlace
    model.layers[index].reflows = reflows
    let resize = inPlace ? IslandChoreography.inPlace : IslandChoreography.resize
    morph(
      to: target,
      motion: MiniPanelShapeMotion(
        thickness: resize.thickness.reduced(model.reduceMotion),
        length: resize.length.reduced(model.reduceMotion)),
      card: next.kind.isCard)
  }

  private func finish() {
    exiting = false
    window.acceptsPointerEvents = true
    content = nil
    activeLayer = nil
    size = nil
    anchor = nil
    dragStart = nil
    setKeyCapable(false)
    window.awaitsField = false
    window.orderOut(nil)
    window.pointerHover.endDrag()
    model.layers = []
    model.layoutMotion = .fixed
    resetCanvas()
    report(false)
  }

  /// Mounts `content` hidden where its measured shape rests, as the content that shows.
  private func mount(_ content: IslandContent, _ measured: IslandMeasure) -> Int {
    nextLayer += 1
    model.layers.append(
      IslandLayer(
        id: nextLayer, content: content, rest: IslandMetrics.rest(measured.size),
        presence: MiniPanelPresence(shown: false, motion: IslandChoreography.content),
        limits: measured.limits, answerOffer: model.answerOffer,
        shellCard: model.shellCard(for: content)))
    activeLayer = nextLayer
    // It takes the keyboard once its shape rests; what is typed until then waits for its field.
    model.arrived = false
    window.awaitsField = takesTyping(content)
    return nextLayer
  }

  private func reveal(_ id: Int, _ motion: MiniPanelContentMotion) {
    guard let index = model.layers.firstIndex(where: { $0.id == id }) else { return }
    model.layers[index].presence = MiniPanelPresence(shown: true, motion: motion)
  }

  /// Every content leaves at once; a leaving card keeps `leavingCard`, the page it showed.
  private func conceal(leavingCard: OptionsCard?) {
    for index in model.layers.indices {
      model.layers[index].presence = MiniPanelPresence(
        shown: false, motion: IslandChoreography.content)
      model.layers[index].followsShape()
      if model.layers[index].content.kind == .choose, model.layers[index].card == nil {
        model.layers[index].card = leavingCard
      }
    }
  }

  private func motion(to target: WindowSize) -> MiniPanelShapeMotion {
    IslandChoreography.shape(from: size ?? target, to: target, reduceMotion: model.reduceMotion)
  }

  private func after(_ seconds: Double, _ body: @escaping @MainActor () -> Void) {
    Task {
      try? await Task.sleep(for: .seconds(seconds))
      body()
    }
  }

  private func report(_ visible: Bool) {
    guard visible != reportedVisible else { return }
    reportedVisible = visible
    onVisibilityChange?(visible)
  }

  private func languageChanged() {
    model.labels = .current()
    guard let content, !exiting else { return }
    update(content, size: measure(content))
  }
}
