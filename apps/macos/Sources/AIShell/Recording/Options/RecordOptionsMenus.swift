import AICore
import AppKit

/// The record bar's Sound and Options menus (architecture R2–R4) and the settings they change.
/// They are the selection toolbar's menus (``ToolbarOptionsCascade`` of ``ToolbarOptionsRow``s,
/// 18 pt corners on 4 pt padding) at ``ToolbarWindow/aboveCapture``, over the capture overlays;
/// their builders (`RecordOptionsMenus+Items.swift`) re-run on every change, so a row shows its
/// new value in place. Every change is saved at once (``RecordingSettingsMemory``), so a
/// recording that starts reads what the bar shows.
///
/// While a menu is open the bar is modal (``isModal``): a press anywhere but on the menus or the
/// bar closes the menus and goes no further, as a press outside a system menu dismisses it, and
/// Escape closes the deepest menu (``closeDeepest()``).
final class RecordOptionsMenus {
  enum Menu {
    case sound, options
  }

  /// A setting changed: the bar shows what will be heard.
  var onChange: (() -> Void)?

  private(set) var settings: RecordingSettings
  /// The inputs connected when a menu last opened, which the Sound menu lists.
  private(set) var microphones: [RecordingMicrophone]
  private let defaults: UserDefaults
  /// Washes the menus' rows; the bar's own buttons follow the pointer themselves.
  private let hover = SelectionToolbarHover()
  private let cascade: ToolbarOptionsCascade
  /// Takes presses outside the menus and the bar while a menu is open.
  private var pressMonitor: Any?
  /// The button the open menu came from, and the bar's glass it hangs from.
  private weak var opener: RecordBarButton?
  private weak var capsule: NSView?

  init(defaults: UserDefaults) {
    self.defaults = defaults
    settings = RecordingSettingsMemory.load(from: defaults)
    microphones = RecordingMicrophones.available()
    cascade = ToolbarOptionsCascade(hover: hover, level: ToolbarWindow.aboveCapture)
    hover.onFrame = { [weak self] view in self?.cascade.pointerAt(view) }
    cascade.onClose = { [weak self] in self?.closed() }
  }

  var isModal: Bool { cascade.isOpen }

  /// The chosen microphone when it is connected; nil records none.
  var microphone: RecordingMicrophone? { settings.microphone(among: microphones) }

  /// Opens `menu` under (or over) the bar from `button`, aligned with it, or closes it if it is
  /// the one open; another open menu closes first.
  func toggle(_ menu: Menu, from button: RecordBarButton, capsule: NSView) {
    let wasOpen = opener === button
    close()
    if !wasOpen { open(menu, from: button, capsule: capsule) }
  }

  /// Escape: closes the deepest menu; false when none is open.
  func closeDeepest() -> Bool {
    guard cascade.isOpen else { return false }
    cascade.closeDeepest()
    return true
  }

  /// Closes every menu; nothing to do when none is open.
  func close() {
    cascade.close()
  }

  /// The bar went away: the menus close.
  func dismiss() {
    close()
  }

  /// Changes the settings, saves them, and shows the change: in place in every open menu, or
  /// closing the deepest one (a value was picked in a submenu).
  func update(closingSubmenu: Bool = false, _ change: (inout RecordingSettings) -> Void) {
    change(&settings)
    RecordingSettingsMemory.save(settings, to: defaults)
    onChange?()
    if closingSubmenu { cascade.closeDeepest() } else { cascade.refresh() }
  }

  // MARK: Opening

  private func open(_ menu: Menu, from button: RecordBarButton, capsule: NSView) {
    guard let window = button.window else { return }
    microphones = RecordingMicrophones.available()
    // Before the cascade opens: starting the hover drops what it follows.
    hover.start([], grip: nil, in: capsule)
    let frame = window.convertToScreen(button.convert(button.bounds, to: nil))
    let glass = window.convertToScreen(capsule.convert(capsule.bounds, to: nil))
    let anchor = NSRect(x: frame.minX, y: glass.minY, width: frame.width, height: glass.height)
    let label = RecordOptionsCopy.text(menu == .sound ? .sound : .title)
    cascade.open(from: button, anchor: anchor, label: label) { [weak self] in
      guard let self else { return [] }
      return menu == .sound ? soundItems() : optionItems()
    }
    guard cascade.isOpen else { return hover.stop() }
    opener = button
    self.capsule = capsule
    button.isActive = true
    watchPresses()
  }

  private func closed() {
    opener?.isActive = false
    opener = nil
    hover.stop()
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
    pressMonitor = nil
  }

  private func watchPresses() {
    guard pressMonitor == nil else { return }
    pressMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    ) { [weak self] event in
      let passes = MainActor.assumeIsolated { self?.passes(event) ?? true }
      return passes ? event : nil
    }
  }

  /// Whether a press while a menu is open goes on: one on a menu's window, which handles it, or
  /// on the bar, whose buttons switch or close the menus; any other closes them.
  private func passes(_ event: NSEvent) -> Bool {
    if event.window is ToolbarWindow { return true }
    if let capsule, let window = capsule.window, event.window === window,
      capsule.bounds.contains(capsule.convert(event.locationInWindow, from: nil))
    {
      return true
    }
    close()
    return false
  }
}
