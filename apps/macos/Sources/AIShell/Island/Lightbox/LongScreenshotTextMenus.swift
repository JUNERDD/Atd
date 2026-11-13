import AICore
import AppKit
import Observation
import SwiftUI

/// The text command row's options menus in the full-screen preview: the selection toolbar's own
/// (``ToolbarOptionsCascade``, ``ToolbarOptionsContent``) with the screenshot-text outputs
/// (``ToolbarOptionsContent/screenshotText``) and no Insert at cursor (the preview records no
/// cursor), opened above the lightbox (``ToolbarWindow/aboveCapture``), as the capture editor's
/// command row opens them (``AnnotationCommandSlot``): a press anywhere else in the app closes
/// them and goes no further, as a press outside a menu does, and Escape closes them first.
///
/// Each command's options button hosts an anchor view (``LongScreenshotTextMenuAnchor``) that the
/// menu opens beside and whose bounds count as the opener's.
@Observable
final class LongScreenshotTextMenus {
  /// The command whose menu is open; its options button shows pressed.
  private(set) var openCommand: String?
  /// A command launched from a menu, with the values it picked.
  @ObservationIgnored var onLaunch: (CommandLaunch) -> Void = { _ in }

  @ObservationIgnored private let services: LongScreenshotTextServices
  @ObservationIgnored private let hover = SelectionToolbarHover()
  @ObservationIgnored private let menus: ToolbarOptionsCascade
  @ObservationIgnored private let options: ToolbarOptionsContent
  @ObservationIgnored private var anchors: [String: LongScreenshotTextMenuAnchor.Box] = [:]
  @ObservationIgnored private var pressMonitor: Any?

  init(services: LongScreenshotTextServices) {
    self.services = services
    menus = ToolbarOptionsCascade(hover: hover, level: ToolbarWindow.aboveCapture)
    options = ToolbarOptionsContent(cascade: menus)
    options.screenshotText = true
    options.cursor = false
    hover.onFrame = { [weak self] view in self?.menus.pointerAt(view) }
    options.onLaunch = { [weak self] launch in
      self?.close()
      self?.onLaunch(launch)
    }
    options.onPick = { id, values in services.onPick(id, values) }
    menus.onClose = { [weak self] in self?.closed() }
  }

  isolated deinit {
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
  }

  var isOpen: Bool { menus.isOpen }

  /// The anchor of command `id`'s options button, which ``toggle(_:)`` opens its menu beside.
  func anchor(for id: String) -> LongScreenshotTextMenuAnchor.Box {
    if let box = anchors[id] { return box }
    let box = LongScreenshotTextMenuAnchor.Box()
    anchors[id] = box
    return box
  }

  /// Opens `command`'s options menu beside its button, or closes it when it is the one open.
  func toggle(_ command: SelectionToolbarSettings.Command) {
    guard let opener = anchors[command.id]?.view, let window = opener.window else { return }
    guard menus.opener !== opener else { return close() }
    close()
    options.catalog = services.catalog()
    let frame = window.convertToScreen(opener.convert(opener.bounds, to: nil))
    hover.start([], grip: nil, in: opener)
    let label = ShellStrings.shared.text(.commandOptionsMenu, command.name)
    menus.open(from: opener, anchor: frame, label: label) { [weak self] in
      self?.options.items(for: command.id) ?? []
    }
    guard menus.isOpen else { return hover.stop() }
    openCommand = command.id
    pressMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) {
      [weak self] event in
      MainActor.assumeIsolated { self?.pressed(event) ?? true } ? event : nil
    }
  }

  /// Escape: closes the menus; false when none was open.
  func dismiss() -> Bool {
    guard menus.isOpen else { return false }
    close()
    return true
  }

  func close() { menus.close() }

  /// A press while the menus are open: one in a panel or on the button that opened them is
  /// theirs (the button closes them again); any other closes them and goes no further.
  private func pressed(_ event: NSEvent) -> Bool {
    if event.window is ToolbarWindow { return true }
    if let opener = menus.opener, event.window === opener.window,
      opener.bounds.contains(opener.convert(event.locationInWindow, from: nil))
    {
      return true
    }
    close()
    return false
  }

  private func closed() {
    openCommand = nil
    options.reset()
    hover.stop()
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
    pressMonitor = nil
  }
}

/// An empty AppKit view behind a command's options button, which its menu opens beside and whose
/// bounds are the button's for the menus' press monitor. It takes no clicks: the button does.
struct LongScreenshotTextMenuAnchor: NSViewRepresentable {
  /// Where the view is kept for the menus, weakly, while the button shows.
  final class Box {
    weak var view: NSView?
  }

  let box: Box

  func makeNSView(context: Context) -> NSView {
    let view = PassiveView()
    box.view = view
    return view
  }

  func updateNSView(_ view: NSView, context: Context) { box.view = view }

  private final class PassiveView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
  }
}
