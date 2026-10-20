import AICore
import AppKit

/// The monitor's content: a scrolling grid of up to four tiles below the toolbar, or one source
/// enlarged in focus mode on the stage over it, or the empty state. Focus changes presentation
/// only: the hidden tiles stop drawing frames, and every registered source keeps its lease.
///
/// The content owns the mode, the grid's arrangement and which tile shows the Enlarge control
/// (the hovered one, else the keyboard-focused one), and reports every change of the mode or the
/// sources to the window (``onStateChange``), which retitles itself and its toolbar.
final class ComputerMonitorContent: NSView {
  /// After a change of the sources or of the mode.
  var onStateChange: (() -> Void)?
  /// The sources in their grid order.
  private(set) var sources: [ComputerMonitorSource] = []
  /// The enlarged source's id in focus mode, nil in grid mode.
  private(set) var focusedId: String?

  private let scroll = NSScrollView()
  private let grid = FlippedView()
  private let stage = ComputerMonitorStage()
  private let empty = ComputerMonitorEmptyView()
  private var tiles: [String: ComputerMonitorTile] = [:]
  private var columns = 1
  private var hovered: String?
  private var keyFocused: String?
  private var active = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    // The scroll view starts below the toolbar (``layout()``), so nothing scrolls under the
    // title bar and no inset is needed.
    scroll.automaticallyAdjustsContentInsets = false
    scroll.documentView = grid
    addSubview(scroll)
    addSubview(stage)
    addSubview(empty)
    localize()
  }

  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { true }
  /// First responder in focus mode, where the arrow keys and Escape act on the stage; it is never
  /// a stop of the key view loop, which walks the tiles.
  override var acceptsFirstResponder: Bool { true }
  override var canBecomeKeyView: Bool { false }

  var focusedSource: ComputerMonitorSource? { sources.first { $0.id == focusedId } }

  func update(_ sources: [ComputerMonitorSource]) {
    // A running transition settles first, so no picture is left on the stage for a tile that
    // goes away.
    stage.finish()
    self.sources = sources
    let ids = Set(sources.map(\.id))
    if let focusedId, !ids.contains(focusedId) {
      // The focused source went away: back to the grid at once.
      stage.release()?.removeFromSuperview()
      self.focusedId = nil
      scroll.isHidden = false
      scroll.alphaValue = 1
    }
    for id in Array(tiles.keys) where !ids.contains(id) {
      tiles[id]?.setActive(false)
      tiles.removeValue(forKey: id)?.removeFromSuperview()
    }
    if let hovered, !ids.contains(hovered) { self.hovered = nil }
    if let keyFocused, !ids.contains(keyFocused) { self.keyFocused = nil }
    for source in sources where tiles[source.id] == nil {
      let tile = makeTile(source)
      tiles[source.id] = tile
      grid.addSubview(tile)
    }
    synchronize()
    // A removed tile that had focus leaves the window itself first responder.
    claimKeyboard()
    onStateChange?()
  }

  /// Makes the content first responder unless it or one of its views already is, so the keys
  /// (``keyDown(with:)``, ``cancelOperation(_:)``) reach it rather than stopping at the window,
  /// which sits past the content in the responder chain. ``performKeyEquivalent(with:)`` needs no
  /// such care: the window offers key equivalents to its whole view hierarchy.
  func claimKeyboard() {
    guard let window else { return }
    if let responder = window.firstResponder as? NSView, responder.isDescendant(of: self) {
      return
    }
    window.makeFirstResponder(self)
  }

  func setActive(_ active: Bool) {
    self.active = active
    synchronize()
  }

  func localize() {
    empty.localize()
    for tile in tiles.values { tile.localize() }
    needsLayout = true
  }

  override func layout() {
    super.layout()
    scroll.frame = CGRect(
      x: 0, y: safeAreaInsets.top, width: bounds.width,
      height: max(0, bounds.height - safeAreaInsets.top))
    stage.frame = bounds
    empty.frame = safeAreaRect
    let width = scroll.contentSize.width
    let height = scroll.contentSize.height
    let layout = ComputerMonitorLayout.grid(count: sources.count, width: width, height: height)
    columns = layout.columns
    grid.frame = CGRect(x: 0, y: 0, width: width, height: layout.height)
    for (source, frame) in zip(sources, layout.tiles) { tiles[source.id]?.frame = frame }
    stage.focusFrame = ComputerMonitorLayout.focus(in: bounds, safeArea: safeAreaInsets)
  }

  // MARK: Focus mode

  /// Enlarges the source at `index` (0-based), or switches to it in focus mode.
  func focus(index: Int) {
    guard sources.indices.contains(index) else { return }
    enlarge(sources[index].id)
  }

  /// Back to the grid, the picture returning to its tile.
  func showAll() {
    guard let id = focusedId, let tile = tiles[id] else { return }
    stage.finish()
    focusedId = nil
    scroll.isHidden = false
    synchronize()
    layoutSubtreeIfNeeded()
    tile.scrollToVisible(tile.bounds)
    let animated = !Self.reduceMotion
    stage.leave(
      to: { [weak self, weak tile] in
        guard let self, let tile else { return .zero }
        return tile.convert(tile.pictureSlot, to: self.stage)
      },
      animated: animated,
      fade: { [weak self] in self?.scroll.alphaValue = $0 },
      completion: { [weak self, weak tile] _ in
        tile?.reattachPicture()
        self?.window?.makeFirstResponder(tile)
      })
    if !animated { crossfade() }
    onStateChange?()
  }

  /// The previous or next source in focus mode, wrapping around.
  func step(by offset: Int) {
    guard let id = focusedId, let index = sources.firstIndex(where: { $0.id == id }),
      sources.count > 1
    else { return }
    let count = sources.count
    enlarge(sources[((index + offset) % count + count) % count].id)
  }

  private func enlarge(_ id: String) {
    guard let tile = tiles[id], focusedId != id else { return }
    if let current = focusedId {
      stage.swap(to: tile.detachPicture()) { _ in tiles[current]?.reattachPicture() }
      focusedId = id
      synchronize()
      onStateChange?()
      return
    }
    stage.finish()
    focusedId = id
    // The grid is about to hide, so no tile will see the pointer leave.
    hovered = nil
    let slot = tile.convert(tile.pictureSlot, to: stage)
    let animated = !Self.reduceMotion
    window?.makeFirstResponder(self)
    stage.enter(
      tile.detachPicture(), from: slot, animated: animated,
      fade: { [weak self] in self?.scroll.alphaValue = 1 - $0 },
      completion: { [weak self] in
        // Hidden, the grid leaves hit testing and the key view loop, and its tiles stop drawing.
        guard let self, self.focusedId != nil else { return }
        self.scroll.isHidden = true
        self.synchronize()
      })
    if !animated { crossfade() }
    onStateChange?()
  }

  /// Reduce Motion's stand-in for the morph: the new layout at once, crossfaded.
  private func crossfade() {
    let fade = CATransition()
    fade.type = .fade
    fade.duration = ComputerMonitorStage.crossfadeDuration
    layer?.add(fade, forKey: kCATransition)
  }

  private static var reduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }

  // MARK: Keyboard

  /// ⌘1–⌘4 enlarge a source in either mode; in focus mode ⌘0 returns to the grid and ⌘[ / ⌘]
  /// step through the sources.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection([.command, .shift, .option, .control])
    guard event.type == .keyDown, modifiers == .command, let key = event.charactersIgnoringModifiers
    else { return super.performKeyEquivalent(with: event) }
    switch key {
    case "1", "2", "3", "4":
      guard let number = Int(key), number <= sources.count else { break }
      focus(index: number - 1)
      return true
    case "0" where focusedId != nil:
      showAll()
      return true
    case "[" where focusedId != nil, "]" where focusedId != nil:
      step(by: key == "[" ? -1 : 1)
      return true
    default:
      break
    }
    return super.performKeyEquivalent(with: event)
  }

  /// In focus mode ← and → step through the sources and Escape returns to the grid; in grid
  /// mode, reached when no tile has focus yet, an arrow focuses the first tile.
  override func keyDown(with event: NSEvent) {
    let direction: ComputerMonitorLayout.Direction? =
      switch event.specialKey {
      case .leftArrow?: .left
      case .rightArrow?: .right
      case .upArrow?: .up
      case .downArrow?: .down
      default: nil
      }
    switch direction {
    case let direction?:
      if focusedId != nil {
        if direction == .left { step(by: -1) }
        if direction == .right { step(by: 1) }
      } else {
        moveFocus(direction)
      }
    case nil:
      if event.charactersIgnoringModifiers == "\u{1b}" {
        cancelOperation(nil)
      } else {
        super.keyDown(with: event)
      }
    }
  }

  override func cancelOperation(_ sender: Any?) {
    if focusedId != nil { showAll() }
  }

  // MARK: Tiles

  /// Moves keyboard focus from the focused tile, or to the first tile when none has it.
  func moveFocus(_ direction: ComputerMonitorLayout.Direction) {
    let index = keyFocused.flatMap { id in sources.firstIndex { $0.id == id } }
    let next =
      index.map {
        ComputerMonitorLayout.neighbor(
          of: $0, direction, count: sources.count, columns: columns)
      } ?? (sources.isEmpty ? nil : 0)
    guard let next, let tile = tiles[sources[next].id] else { return }
    window?.makeFirstResponder(tile)
    tile.scrollToVisible(tile.bounds)
  }

  private func makeTile(_ source: ComputerMonitorSource) -> ComputerMonitorTile {
    let id = source.id
    return ComputerMonitorTile(
      source: source,
      events: .init(
        enlarge: { [weak self] in self?.enlarge(id) },
        hover: { [weak self] inside in
          guard let self else { return }
          if inside {
            self.hovered = id
          } else if self.hovered == id {
            self.hovered = nil
          }
          self.updateControls()
        },
        focus: { [weak self] focused in
          guard let self else { return }
          if focused {
            self.keyFocused = id
          } else if self.keyFocused == id {
            self.keyFocused = nil
          }
          self.updateControls()
        },
        move: { [weak self] in self?.moveFocus($0) }))
  }

  /// One Enlarge control at a time: on the hovered tile, else on the keyboard-focused one.
  private func updateControls() {
    let shown = focusedId == nil ? hovered ?? keyFocused : nil
    for (id, tile) in tiles { tile.setControlShown(id == shown) }
  }

  /// Applies the mode: which tiles draw frames, the empty state and the controls. The focused
  /// tile always draws; the others stop once the grid is hidden behind the stage.
  private func synchronize() {
    empty.isHidden = !sources.isEmpty
    for (id, tile) in tiles {
      tile.setActive(active && (focusedId == nil || focusedId == id || !scroll.isHidden))
    }
    updateControls()
    needsLayout = true
  }

  private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
  }
}
