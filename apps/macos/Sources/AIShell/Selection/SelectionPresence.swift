import AICore
import AppKit
import ApplicationServices
import Synchronization

/// The selection toolbar's Accessibility check (grill decision Q4): whether the frontmost app's
/// focused element has a non-empty selection, and where it is. It asks only for the selection's
/// range, length, bounds or the custom editor's Copy availability, never for the text, which
/// ``SelectionReader`` reads only when the user picks a toolbar action.
///
/// - Every AX message is bounded by a 100 ms messaging timeout set on each element it asks
///   (never on the system-wide element, which would change the default of every read).
/// - A secure text field answers ``SelectionProbe/secureField`` before anything else is asked.
/// - `AXSelectedTextRange` first; web content (WebKit, Chromium) reports its selection as a
///   text-marker range, whose length and bounds it answers without the text.
/// - Cell-based tables report selected cell identities. Opaque editors can supply only a Copy
///   menu hint (``SelectionEditMenu``); the action verifies that it really copies text.
/// - Electron and Chromium build their web tree only once an assistive tool asks the
///   application something (``wakeWebContent(_:)``), so each probe does, and
///   ``prepare(pid:bundleURL:)`` does it ahead of time when an Electron app comes forward.
///
/// Blocking; call it off the main thread.
nonisolated struct SelectionPresence: Sendable {
  static let messagingTimeout: Float = 0.1

  let pid: pid_t

  func probe() -> SelectionProbe {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, Self.messagingTimeout)
    Self.wakeWebContent(app)
    guard let focused: AXUIElement = Self.copy(app, kAXFocusedUIElementAttribute) else {
      return .none
    }
    AXUIElementSetMessagingTimeout(focused, Self.messagingTimeout)
    let secure = kAXSecureTextFieldSubrole as String
    let role: String? = Self.copy(focused, kAXRoleAttribute)
    let subrole: String? = Self.copy(focused, kAXSubroleAttribute)
    if role == secure || subrole == secure { return .secureField }

    let surface = SelectionSurface(focused)
    if let probe = textProbe(focused) { return probe }
    if surface.selectedCellContainer() != nil { return .cells }
    // Some editors focus a wrapper and expose the text selection on a child or ancestor.
    // Keep this search local and bounded, as SelectionReader does for an explicit read.
    let deadline = ContinuousClock.now + .milliseconds(150)
    let children: [AXUIElement] = Self.copy(focused, kAXChildrenAttribute) ?? []
    for child in children.prefix(20) where ContinuousClock.now < deadline {
      if let probe = textProbe(child) { return probe }
    }
    var current = focused
    for _ in 0..<6 where ContinuousClock.now < deadline {
      guard let parent: AXUIElement = Self.copy(current, kAXParentAttribute) else { break }
      let role: String? = Self.copy(parent, kAXRoleAttribute)
      if role == kAXWindowRole || role == kAXApplicationRole { break }
      if let probe = textProbe(parent) { return probe }
      current = parent
    }
    return surface.opaqueEditor && SelectionEditMenu(focused)?.hasSelection == true
      ? .unmeasured : .none
  }

  private func textProbe(_ element: AXUIElement) -> SelectionProbe? {
    AXUIElementSetMessagingTimeout(element, Self.messagingTimeout)
    let surface = SelectionSurface(element)
    let subrole: String? = Self.copy(element, kAXSubroleAttribute)
    if subrole == kAXSecureTextFieldSubrole { return .secureField }
    if surface.advertisesTextRange,
      let rangeValue: AXValue = Self.copy(element, kAXSelectedTextRangeAttribute)
    {
      var range = CFRange()
      let valid = AXValueGetValue(rangeValue, .cfRange, &range)
      if valid, range.length > 0 {
        let bounds: AXValue? = Self.copy(
          element, kAXBoundsForRangeParameterizedAttribute, rangeValue)
        return .selected(length: range.length, bounds: bounds.flatMap(Self.rect))
      }
      if valid, surface.nativeText, range.length == 0 { return SelectionProbe.none }
    }
    if let marker: CFTypeRef = Self.copy(element, "AXSelectedTextMarkerRange"),
      let length: Int = Self.copy(element, "AXLengthForTextMarkerRange", marker), length > 0
    {
      let bounds: AXValue? = Self.copy(element, "AXBoundsForTextMarkerRange", marker)
      return .selected(length: length, bounds: bounds.flatMap(Self.rect))
    }
    return nil
  }

  /// Asks the application for its `AXRole`. Chromium's and Electron's `accessibilityRole`
  /// override treats that as Apple recommends for assistive tools such as Voice Control: an app
  /// with no accessibility mode yet turns on its basic one (native elements and web content)
  /// and builds the tree asynchronously. Setting `AXManualAccessibility` would turn on the
  /// complete mode instead, which VS Code and Cursor take for a screen reader: they prompt,
  /// switch the editor to screen-reader mode, and a "No" writes a user setting. Other apps just
  /// answer. Electron keeps the basic mode for the life of the process, so repeating the read
  /// costs one message. The write target's capture and the answer card's focus check wake the
  /// app the same way before they ask for its focus.
  static func wakeWebContent(_ app: AXUIElement) {
    var role: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &role)
  }

  private static func rect(_ value: AXValue) -> CGRect? {
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
    else { return nil }
    return value as? T
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String, _ parameter: CFTypeRef)
    -> T?
  {
    var value: CFTypeRef?
    let error = AXUIElementCopyParameterizedAttributeValue(
      element, attribute as CFString, parameter, &value)
    return error == .success ? value as? T : nil
  }
}

extension SelectionPresence {
  /// Where probes run: a serial queue of their own, so a blocking AX read never holds one of
  /// Swift concurrency's few cooperative threads while an unresponsive app runs out its
  /// timeouts.
  private nonisolated static let queue = DispatchQueue(
    label: "com.junerdd.ai.selection-presence", qos: .userInitiated)
  /// A probe is running; a gesture meanwhile is not asked about (the app is still answering
  /// the last one, and the caller drops stale answers anyway).
  private nonisolated static let busy = Mutex(false)

  /// Where ``prepare(pid:bundleURL:)`` runs, apart from the probes' queue so preparing a slow
  /// app never holds up a selection check.
  private nonisolated static let prepareQueue = DispatchQueue(
    label: "com.junerdd.ai.selection-prepare", qos: .utility)

  /// Prepares editing-menu handles and wakes Electron's web content ahead of the first selection:
  /// discovery can take longer than a quick gesture gives the first probe. Only apps that ship
  /// Electron's framework have their web content woken early, so merely bringing a browser
  /// forward never changes its accessibility state.
  nonisolated static func prepare(pid: pid_t, bundleURL: URL?) {
    guard let bundleURL else { return }
    prepareQueue.async {
      SelectionEditMenu.prepare(pid: pid)
      let framework = bundleURL.appendingPathComponent(
        "Contents/Frameworks/Electron Framework.framework", isDirectory: true)
      guard FileManager.default.fileExists(atPath: framework.path) else { return }
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, messagingTimeout)
      wakeWebContent(app)
    }
  }

  /// Wakes the web content of the app a command is summoned from, off the main thread, as soon
  /// as the shortcut fires: a browser that had no accessibility mode yet builds its tree while
  /// the selection is read, so its focused field answers by the time the write target is.
  nonisolated static func wake(pid: pid_t) {
    prepareQueue.async {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, messagingTimeout)
      wakeWebContent(app)
    }
  }

  /// Checks off the main thread and gives up after `limit`, a net under the per-message
  /// timeouts; a late answer is dropped.
  static func check(pid: pid_t, limit: Duration = .milliseconds(300)) async -> SelectionProbe {
    let claimed = busy.withLock { busy in
      guard !busy else { return false }
      busy = true
      return true
    }
    guard claimed else { return .none }
    let presence = SelectionPresence(pid: pid)
    return await Deadline.value(within: limit, fallback: .none) {
      await withCheckedContinuation { continuation in
        queue.async {
          let probe = presence.probe()
          busy.withLock { $0 = false }
          continuation.resume(returning: probe)
        }
      }
    }
  }
}
