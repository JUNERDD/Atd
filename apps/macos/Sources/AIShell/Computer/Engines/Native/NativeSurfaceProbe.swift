import AICore
import AppKit
import ApplicationServices
import CoreGraphics

/// What the shell reads itself about an app's windows and the surfaces on them: accessibility
/// for roles, subroles, modality, titles and parent relations, the window server for window ids
/// and other processes' panels. Nothing here sends input or activates anything. Accessibility
/// queries can block on a busy app (a short messaging timeout bounds each), so callers run them
/// off the main actor (``NativeTargetProbe/detached(_:)``).
nonisolated enum NativeSurfaceProbe {
  /// A window of an app, as resolving names its root.
  struct AppWindow: Equatable, Sendable {
    let windowId: Int
    let title: String?
    /// Quartz global points.
    let frame: CGRect
  }

  /// The system's open and save panel service, which draws sandboxed apps' file panels.
  static let panelServiceBundleId = "com.apple.appkit.xpc.openAndSavePanelService"

  /// The app's standard windows that are not minimized, each matched to its window-server id by
  /// frame; a window whose id cannot be told apart is left out rather than guessed.
  static func standardWindows(pid: pid_t) -> [AppWindow] {
    let listed = serverWindows(of: pid)
    return axWindows(pid: pid).compactMap { window in
      guard attribute(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole,
        attribute(window, kAXMinimizedAttribute) as? Bool != true, let frame = frame(of: window),
        case .success(let id) = NativeWindowMatch.windowId(
          frame: frame, pid: Int(pid), among: listed)
      else { return nil }
      return AppWindow(
        windowId: id, title: attribute(window, kAXTitleAttribute) as? String, frame: frame)
    }
  }

  /// The app's root window by the root-window rule (``NativeRootWindow``): `AXMainWindow`, else
  /// `AXFocusedWindow`, else its front-most visible window on screen, else a standard window.
  static func rootWindow(pid: pid_t) -> AppWindow? {
    let listed = serverWindows(of: pid)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    func described(_ window: AXUIElement?) -> (window: AppWindow, minimized: Bool)? {
      guard let window, let frame = frame(of: window),
        case .success(let id) = NativeWindowMatch.windowId(
          frame: frame, pid: Int(pid), among: listed)
      else { return nil }
      return (
        AppWindow(
          windowId: id, title: attribute(window, kAXTitleAttribute) as? String, frame: frame),
        attribute(window, kAXMinimizedAttribute) as? Bool == true
      )
    }
    let main = described(element(app, kAXMainWindowAttribute))
    let focused = described(element(app, kAXFocusedWindowAttribute))
    let standard = axWindows(pid: pid).filter {
      attribute($0, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole
    }.compactMap(described)
    let frontmost = windowList(.optionOnScreenOnly).first { info in
      (info[kCGWindowOwnerPID as String] as? pid_t) == pid
        && (info[kCGWindowLayer as String] as? Int) == 0
        && (info[kCGWindowAlpha as String] as? Double ?? 1) > 0
        && bounds(of: info).map { $0.width > 1 && $0.height > 1 } == true
    }.flatMap { $0[kCGWindowNumber as String] as? Int }
    let candidate = { (found: (window: AppWindow, minimized: Bool)) in
      NativeRootWindow.Candidate(windowId: found.window.windowId, minimized: found.minimized)
    }
    guard
      let id = NativeRootWindow.choose(
        main: main.map(candidate), focused: focused.map(candidate), frontmost: frontmost,
        standard: standard.map(candidate))
    else { return nil }
    let known = ([main, focused].compactMap { $0 } + standard).map(\.window)
    if let window = known.first(where: { $0.windowId == id }) { return window }
    let ax = axWindows(pid: pid).compactMap { described($0)?.window }
    return ax.first { $0.windowId == id }
      ?? listed.first { $0.windowId == id }.map {
        AppWindow(windowId: id, title: nil, frame: $0.bounds ?? .zero)
      }
  }

  /// Everything ``NativeSurfaceOwnership`` decides on for the app `pid`.
  static func facts(pid: pid_t, processStart: String) -> NativeSurfaceFacts {
    let listed = serverWindows(of: pid)
    var windows: [NativeSurfaceFacts.Window] = []
    for window in axWindows(pid: pid) {
      let element = describe(window)
      let id = element.frame.flatMap {
        try? NativeWindowMatch.windowId(frame: $0, pid: Int(pid), among: listed).get()
      }
      let children = (attribute(window, kAXChildrenAttribute) as? [AXUIElement] ?? [])
        .map(describe).filter { ["AXSheet", "AXPopover"].contains($0.role) }
      windows.append(.init(windowId: id, element: element, children: children))
    }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    let menus = (attribute(app, kAXChildrenAttribute) as? [AXUIElement] ?? []).map(describe)
      .filter { $0.role == kAXMenuRole }
    return NativeSurfaceFacts(
      pid: Int(pid), processStart: processStart, windows: windows, menus: menus,
      foreign: panelWindows(near: windows))
  }

  /// Whether the app answers accessibility for its windows at all.
  static func treeReadable(pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success
  }

  /// The window-server ids of all of the app's windows now, for telling which appeared later.
  static func windowIds(of pid: pid_t) -> Set<Int> {
    Set(serverWindows(of: pid).map(\.windowId))
  }

  /// The live frame of window `windowId` of `pid`, from the window server.
  static func frame(windowId: Int, pid: pid_t) -> CGRect? {
    serverWindows(of: pid).first { $0.windowId == windowId }?.bounds
  }

  /// The accessibility window of `pid` that is window-server window `windowId`, matched by frame
  /// as resolving matches them; nil when none matches, or several frames do. Every message is
  /// bounded by `timeout`, set on the app and on each window it reads, and the whole search by four
  /// such timeouts, so an app that hangs cannot hold it up window after window. The window it
  /// returns keeps that bound for what the caller sends it next.
  static func axWindow(pid: pid_t, windowId: Int, timeout: Float) -> AXUIElement? {
    let end = ContinuousClock.now + .seconds(Double(timeout) * 4)
    let listed = serverWindows(of: pid)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, timeout)
    let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
    return windows.lazy.prefix { _ in ContinuousClock.now < end }.first { window in
      AXUIElementSetMessagingTimeout(window, timeout)
      guard let frame = frame(of: window),
        case .success(let id) = NativeWindowMatch.windowId(
          frame: frame, pid: Int(pid), among: listed)
      else { return false }
      return id == windowId
    }
  }

  /// The window-server id of `pid`'s focused window (`AXFocusedWindow`), where its keys go while
  /// it is the active app; nil when it has none or its frame matches no single window.
  static func focusedWindowId(pid: pid_t) -> Int? {
    windowId(named: kAXFocusedWindowAttribute, pid: pid)
  }

  /// The window-server id of `pid`'s main window (`AXMainWindow`); nil when it has none or its
  /// frame matches no single window.
  static func mainWindowId(pid: pid_t) -> Int? {
    windowId(named: kAXMainWindowAttribute, pid: pid)
  }

  /// The window-server id of the window the app `pid` names in `attribute`, every message, the
  /// window's own included, bounded by a quarter of a second, since a foreground step reads it
  /// while the app is in front of the person.
  private static func windowId(named attribute: String, pid: pid_t) -> Int? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.25)
    guard let window = element(app, attribute) else { return nil }
    AXUIElementSetMessagingTimeout(window, 0.25)
    guard let frame = frame(of: window),
      case .success(let id) = NativeWindowMatch.windowId(
        frame: frame, pid: Int(pid), among: serverWindows(of: pid))
    else { return nil }
    return id
  }

  /// Read only the focused field's bounds for input feedback; never its value. An absent,
  /// secure, ambiguous or other-window field has no trustworthy position to draw.
  static func focusedTextFrame(windowId: Int, pid: pid_t) -> CGRect? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    guard let focused: AXUIElement = try? AXField.copy(app, kAXFocusedUIElementAttribute) else {
      return nil
    }
    AXUIElementSetMessagingTimeout(focused, 0.1)
    guard let role = attribute(focused, kAXRoleAttribute) as? String,
      NativeObservation.textInputRoles.contains(role),
      attribute(focused, kAXSubroleAttribute) as? String != kAXSecureTextFieldSubrole,
      let window: AXUIElement = try? AXField.copy(focused, kAXWindowAttribute)
    else { return nil }
    AXUIElementSetMessagingTimeout(window, 0.1)
    guard let bounds = frame(of: window),
      case .success(let matched) = NativeWindowMatch.windowId(
        frame: bounds, pid: Int(pid), among: serverWindows(of: pid)), matched == windowId,
      let field = frame(of: focused), bounds.contains(field)
    else { return nil }
    return field
  }

  // MARK: Window server

  /// The app's layer-0 windows, on screen or not (minimized, other Spaces).
  private static func serverWindows(of pid: pid_t) -> [NativeWindowMatch.ServerWindow] {
    windowList(.optionAll).compactMap { info in
      guard (info[kCGWindowOwnerPID as String] as? pid_t) == pid,
        (info[kCGWindowLayer as String] as? Int) == 0,
        let id = info[kCGWindowNumber as String] as? Int
      else { return nil }
      return NativeWindowMatch.ServerWindow(windowId: id, pid: Int(pid), bounds: bounds(of: info))
    }
  }

  /// On-screen windows of the panel service that overlap one of the app's sheets or dialogs.
  private static func panelWindows(near windows: [NativeSurfaceFacts.Window])
    -> [NativeSurfaceFacts.ForeignWindow]
  {
    let frames = windows.flatMap { [$0.element] + $0.children }.compactMap(\.frame)
    guard !frames.isEmpty else { return [] }
    return windowList(.optionOnScreenOnly).compactMap { info in
      guard let pid = info[kCGWindowOwnerPID as String] as? pid_t,
        let id = info[kCGWindowNumber as String] as? Int, let frame = bounds(of: info),
        frames.contains(where: { $0.intersects(frame) }),
        NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == panelServiceBundleId,
        let start = NativeTargetProbe.processStart(pid: pid)
      else { return nil }
      return .init(
        windowId: id, pid: Int(pid), processStart: String(start), frame: frame,
        isPanelService: true)
    }
  }

  private static func windowList(_ option: CGWindowListOption) -> [[String: Any]] {
    (CGWindowListCopyWindowInfo(option, kCGNullWindowID) as? [[String: Any]]) ?? []
  }

  private static func bounds(of info: [String: Any]) -> CGRect? {
    guard let dictionary = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: dictionary as CFDictionary)
  }

  // MARK: Accessibility

  private static func axWindows(pid: pid_t) -> [AXUIElement] {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    return attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
  }

  private static func describe(_ element: AXUIElement) -> NativeSurfaceFacts.Element {
    NativeSurfaceFacts.Element(
      role: attribute(element, kAXRoleAttribute) as? String ?? "",
      subrole: attribute(element, kAXSubroleAttribute) as? String,
      identifier: attribute(element, kAXIdentifierAttribute) as? String,
      title: attribute(element, kAXTitleAttribute) as? String, frame: frame(of: element),
      modal: attribute(element, kAXModalAttribute) as? Bool == true)
  }

  private static func element(_ parent: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(parent, name), CFGetTypeID(value) == AXUIElementGetTypeID() else {
      return nil
    }
    return (value as! AXUIElement)
  }

  private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
      return nil
    }
    return value
  }

  private static func frame(of element: AXUIElement) -> CGRect? {
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard let position = attribute(element, kAXPositionAttribute),
      let extent = attribute(element, kAXSizeAttribute),
      CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(extent) == AXValueGetTypeID(),
      AXValueGetValue(position as! AXValue, .cgPoint, &origin),
      AXValueGetValue(extent as! AXValue, .cgSize, &size)
    else { return nil }
    return CGRect(origin: origin, size: size)
  }
}
