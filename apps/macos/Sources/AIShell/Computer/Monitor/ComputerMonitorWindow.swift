import AICore
import AppKit

/// An independent standard window. Chat visibility, navigation and reload never own its lifetime.
/// Closing or minimizing it ends presentation only; it never stops a source.
///
/// Like the shell's other glass titled windows, it is clear and non-opaque, and its whole content
/// stands on the window material, here on the shell's base surface fill
/// (``ComputerMonitorBackground``); the material owns the clipping, edge and shadow. The window
/// takes the app's scheme as every window does. The unified toolbar lies over the glass without
/// a background or divider of its own, and the content starts below it.
///
/// The window is made once and kept: it reopens where it was, and the frame autosave carries that
/// place across launches, constrained to the work area of the display it lands on. Keep on Top
/// lasts for the app session.
final class ComputerMonitorWindow: NSObject, NSWindowDelegate {
  private static let frameName = "ComputerMonitorWindow"

  private var window: NSWindow?
  private var open = false
  private var keepOnTop = false
  private let content = ComputerMonitorContent(frame: .zero)
  private lazy var background = ComputerMonitorBackground(content: content)
  private lazy var toolbar = ComputerMonitorToolbar(
    actions: .init(
      allSources: { [weak self] in self?.content.showAll() },
      previous: { [weak self] in self?.content.step(by: -1) },
      next: { [weak self] in self?.content.step(by: 1) },
      keepOnTop: { [weak self] in self?.toggleKeepOnTop() }))
  private let onPresentation: (Bool) -> Void

  init(onPresentation: @escaping (Bool) -> Void) {
    self.onPresentation = onPresentation
    super.init()
    content.onStateChange = { [weak self] in self?.refreshChrome() }
    NotificationCenter.default.addObserver(
      self, selector: #selector(localize), name: ShellStrings.didChange, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  var isOpen: Bool { open }
  var isPresenting: Bool { open && window?.isVisible == true && window?.isMiniaturized == false }

  func update(_ sources: [ComputerMonitorSource]) { content.update(sources) }

  func show() {
    NSApp.activate()
    let window = window ?? makeWindow()
    if window.isMiniaturized { window.deminiaturize(nil) }
    if !open { constrain(window) }
    open = true
    window.makeKeyAndOrderFront(nil)
    content.claimKeyboard()
    content.setActive(true)
  }

  func close() { window?.close() }

  func windowWillClose(_ notification: Notification) {
    content.setActive(false)
    open = false
    onPresentation(false)
  }

  func windowDidBecomeKey(_ notification: Notification) { content.claimKeyboard() }

  func windowDidMiniaturize(_ notification: Notification) {
    content.setActive(false)
    onPresentation(false)
  }

  func windowDidDeminiaturize(_ notification: Notification) {
    content.setActive(true)
    onPresentation(true)
  }

  /// A titled window under a unified toolbar, its content running under the bar. The first
  /// opening is 960×640 points, centered in the work area under the pointer, unless the frame
  /// autosave remembers a place from an earlier launch.
  private func makeWindow() -> NSWindow {
    let area = NSRect(Screens.workAreaUnderCursor())
    let size = CGSize(width: min(960, area.width), height: min(640, area.height))
    let window = NSWindow(
      contentRect: CGRect(
        x: area.midX - size.width / 2, y: area.midY - size.height / 2,
        width: size.width, height: size.height),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    // Glass in a full-screen space has nothing behind it, as for the shell's other glass windows.
    window.collectionBehavior = [.fullScreenNone]
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.titlebarAppearsTransparent = true
    window.titlebarSeparatorStyle = .none
    window.toolbar = toolbar.toolbar
    window.toolbarStyle = .unified
    window.contentView = background.view
    window.autorecalculatesKeyViewLoop = true
    window.initialFirstResponder = content
    window.delegate = self
    window.setFrameUsingName(Self.frameName)
    window.setFrameAutosaveName(Self.frameName)
    self.window = window
    refreshChrome()
    return window
  }

  /// The title, the subtitle naming what is shown, and the toolbar for the mode.
  private func refreshChrome() {
    let strings = ShellStrings.shared
    let sources = content.sources
    let focused = content.focusedSource
    window?.title = strings.text(.computerMonitorTitle)
    window?.subtitle =
      if let focused {
        focused.label
      } else if sources.count == 1 {
        sources[0].label
      } else if sources.count > 1 {
        strings.text(.computerMonitorSourceCount, count: sources.count)
      } else {
        ""
      }
    toolbar.update(
      mode: focused == nil ? .grid : .focus(multiple: sources.count > 1), keepOnTop: keepOnTop)
  }

  private func toggleKeepOnTop() {
    keepOnTop.toggle()
    window?.level = keepOnTop ? .floating : .normal
    refreshChrome()
  }

  @objc private func localize() {
    content.localize()
    toolbar.localize()
    refreshChrome()
  }

  @objc private func screensChanged() {
    guard let window, open else { return }
    constrain(window)
  }

  /// Keeps the window, and its minimum size, within the work area of the display holding most
  /// of it.
  private func constrain(_ window: NSWindow) {
    let area = NSRect(Screens.workArea(containing: ScreenRect(window.frame)))
    window.contentMinSize = CGSize(width: min(360, area.width), height: min(260, area.height))
    let constrained = PanelGeometry.constrain(ScreenRect(window.frame), to: ScreenRect(area))
    if constrained != ScreenRect(window.frame) {
      window.setFrame(NSRect(constrained), display: true)
    }
  }
}
