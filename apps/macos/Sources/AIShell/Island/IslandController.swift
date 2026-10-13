import AICore
import AppKit
import SwiftUI

/// Runs the command island (the "Dynamic Island" of a command that runs without the panel): one
/// glass shape at the bottom of the screen that enters at its first content's size as the
/// selection toolbar does (``SelectionToolbarEntrance``), morphs from content to content as the
/// mini panel's body does, and leaves as one piece, its content shrinking a little with the shape
/// as it fades (``IslandChoreography``). Each change sets the shape and the contents' presence once,
/// with the animation each moves on, and SwiftUI runs them; nothing is written while anything
/// moves. Content leaves before the shape moves and arrives after it. The window's alpha carries
/// the fades, so the glass fades with its content.
///
/// Placement is the glass HUDs' (``GlassHUDPlacement``): every appearance starts at home, the
/// bottom centre of the display under the pointer; the working capsule's grip drags it within
/// the work area, and a double-click puts it back. Shapes stand on the same bottom edge
/// (``IslandMetrics/rest(_:)``), so the card grows up out of the capsule.
///
/// The owner decides what shows (``show(_:)``, ``exit()``) and when the window may take the
/// keyboard (``setKeyCapable(_:)``, the options card and the answer card).
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
  /// summary arriving, the language), else morphed into from what shows.
  func show(_ next: IslandContent) {
    let target = measure(next)
    generation += 1
    if !window.isVisible {
      appear(next, size: target)
    } else if exiting {
      turnBack(next, size: target)
    } else if let content, content.kind == next.kind {
      update(next, size: target)
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

  /// The island leaves as one piece, the entrance in reverse: its content stays in the glass and
  /// follows the shape as it shrinks to ``SelectionToolbarEntrance/startScale`` toward its bottom
  /// edge while the window fades out, eased in over ``IslandChoreography/exitDuration``. The
  /// content never goes first, so the glass never shows empty. Clicks pass through from the
  /// start, so nothing on its way out can be pressed. Under Reduce Motion it only fades.
  func exit() {
    guard window.isVisible, !exiting else { return }
    exiting = true
    generation += 1
    let token = generation
    window.ignoresMouseEvents = true
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
    window.ignoresMouseEvents = false
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

  /// Lets the window take the keyboard, and takes it, or no longer lets it and gives it up; the
  /// owner then focuses the field the keyboard goes back to.
  ///
  /// A key window stays key after it can no longer become key, and this one never activated Atd:
  /// the app in front is already active, so activating it again moves nothing, and every key
  /// press, a write's ⌘V included, would keep reaching the island. Ordering the window out and
  /// straight back in, within one turn of the run loop, hands the keyboard back to that app's
  /// key window with no visible change.
  func setKeyCapable(_ capable: Bool) {
    window.keyCapable = capable
    if capable, window.isVisible {
      window.makeKey()
    } else if !capable, window.isKeyWindow, window.isVisible {
      window.orderOut(nil)
      window.orderFrontRegardless()
    }
  }

  /// The text field typing into the card, while it has the keyboard.
  var editingField: NSTextView? { window.editingField }

  // MARK: Choreography

  /// Enters as the selection toolbar does, shape and content together: the shape, already at its
  /// first content's measured size, springs from ``SelectionToolbarEntrance/startScale`` of it
  /// and ``SelectionToolbarEntrance/rise`` points below, out of its bottom edge, as the window
  /// fades in and the content arrives (``IslandChoreography/entering``: no delay), following the
  /// shape. Under Reduce Motion the shape stands at its size, and window and content only fade.
  ///
  /// The window shows nothing until that start is drawn: it is ordered in at alpha 0 with a
  /// fresh view tree (``IslandModel/appearance``), so neither the previous island's last frame
  /// nor any animation still running from it can show, and laid out and drawn before the fade
  /// and the spring begin a frame later. The fade belongs to the window's entrance, not to its
  /// first content: a show within that frame replaces the content, and the window still fades in.
  private func appear(_ next: IslandContent, size measured: IslandMeasure) {
    let target = measured.size
    exiting = false
    window.ignoresMouseEvents = false
    anchor = clamped(home(target), size: target)
    placeWindow()
    model.appearance += 1
    model.layers = []
    let entrance = SelectionToolbarEntrance.self
    let rest = IslandShape(
      frame: IslandMetrics.rest(target),
      corner: IslandMetrics.corner(target, card: next.kind.isCard))
    model.shape =
      model.reduceMotion ? rest : rest.scaled(entrance.startScale, drop: entrance.rise)
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
      if !model.reduceMotion, let size {
        // A change in place meanwhile may have moved the rest; the spring goes to where it is.
        let spring = MiniPanelSpring(entrance.duration, entrance.bounce)
        model.shape = IslandShape(
          frame: IslandMetrics.rest(size),
          corner: IslandMetrics.corner(size, card: content?.kind.isCard == true),
          animation: spring.animation)
      }
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
  /// expand springs, or for the compose card, which resizes under the person's typing and
  /// attaching, and the answer card, whose write actions follow the person's focus, without
  /// bounce and with its content moving at its own size (``IslandChoreography/inPlace``).
  private func update(_ next: IslandContent, size measured: IslandMeasure) {
    let target = measured.size
    guard let index = model.layers.firstIndex(where: { $0.id == activeLayer }) else {
      return replace(next, size: measured, leavingCard: model.card)
    }
    model.layers[index].content = next
    model.layers[index].limits = measured.limits
    guard target != size else { return }
    model.layers[index].rest = IslandMetrics.rest(target)
    let inPlace = next.kind == .compose || next.kind == .answer
    model.layers[index].scales = !inPlace
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
    window.ignoresMouseEvents = false
    content = nil
    activeLayer = nil
    size = nil
    anchor = nil
    dragStart = nil
    setKeyCapable(false)
    window.orderOut(nil)
    model.layers = []
    report(false)
  }

  /// Mounts `content` hidden where its measured shape rests, as the content that shows.
  private func mount(_ content: IslandContent, _ measured: IslandMeasure) -> Int {
    nextLayer += 1
    model.layers.append(
      IslandLayer(
        id: nextLayer, content: content, rest: IslandMetrics.rest(measured.size),
        presence: MiniPanelPresence(shown: false, motion: IslandChoreography.content),
        limits: measured.limits))
    activeLayer = nextLayer
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
      model.layers[index].scales = true
      if model.layers[index].content.kind == .choose, model.layers[index].card == nil {
        model.layers[index].card = leavingCard
      }
    }
  }

  private func morph(to target: WindowSize, motion: MiniPanelShapeMotion, card: Bool) {
    model.shape = IslandShape(
      frame: IslandMetrics.rest(target), corner: IslandMetrics.corner(target, card: card),
      animation: motion.animation(thickness: .vertical))
    size = target
    if let anchor {
      let inside = clamped(anchor, size: target)
      if inside != anchor {
        self.anchor = inside
        placeWindow()
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
