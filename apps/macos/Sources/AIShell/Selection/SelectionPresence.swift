import AICore
import AppKit
import ApplicationServices
import Synchronization

/// The selection toolbar's Accessibility check: whether the frontmost app's focused element has a
/// readable selection, and where it is. ``SelectionProbe`` carries only the selection's length and
/// bounds (or the custom editor's Copy availability); ``SelectionTextProbe`` verifies bounded
/// selections against ``TextCapture/hasContent(_:)`` without retaining text so attachment-only and
/// whitespace-only selections do not summon a toolbar whose actions would find nothing.
///
/// - Every AX message is bounded by a 100 ms messaging timeout set on each element it asks
///   (never on the system-wide element, which would change the default of every read).
/// - A secure text field answers ``SelectionProbe/secureField`` before anything else is asked.
/// - `AXSelectedTextRange` first, then web content's `AXSelectedTextMarkerRange`
///   (``SelectionTextProbe``).
/// - Cell-based tables report selected cell identities. Opaque editors can supply only a Copy
///   menu hint (``SelectionEditMenu``); the action verifies that it really copies text.
/// - Electron and Chromium build their web tree only once an assistive tool asks the
///   application something (``wakeWebContent(_:)``), so each probe does, and
///   ``prepare(pid:bundleURL:)`` does it ahead of time when an Electron app comes forward.
///
/// Blocking; call it off the main thread.
package nonisolated struct SelectionPresence: Sendable {
  static let messagingTimeout: Float = 0.1

  let pid: pid_t

  package init(pid: pid_t) { self.pid = pid }

  /// A toolbar gesture supplies its starting point in Quartz screen coordinates. Focus-only
  /// checks (such as the answer card's write target) do not depend on the pointer.
  package func probe(gestureAt origin: CGPoint? = nil) -> SelectionProbe {
    probe(gestureAt: origin, wps: nil).probe
  }

  func probe(
    gestureAt origin: CGPoint?,
    wps: WpsSelectionEvidence?
  ) -> (probe: SelectionProbe, trace: SelectionProbeTrace) {
    let startNs = MonotonicTimestampAnchor.nowUptimeNs()
    var trace = SelectionProbeTrace()
    func finish(_ outcome: SelectionProbe) -> (probe: SelectionProbe, trace: SelectionProbeTrace) {
      let elapsedUs = (MonotonicTimestampAnchor.nowUptimeNs() &- startNs) / 1_000
      trace.elapsedUs = UInt16(clamping: elapsedUs)
      return (outcome, trace)
    }

    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, Self.messagingTimeout)
    let wakeError = Self.wakeWebContent(app)
    if Self.isAbnormalAxError(wakeError) {
      trace.lastAxError = Int16(clamping: wakeError.rawValue)
    }
    var focusedValue: CFTypeRef?
    let focusError = AXUIElementCopyAttributeValue(
      app, kAXFocusedUIElementAttribute as CFString, &focusedValue)
    guard focusError == .success, let focusedValue,
      CFGetTypeID(focusedValue) == AXUIElementGetTypeID()
    else {
      if Self.isAbnormalAxError(focusError) {
        trace.lastAxError = Int16(clamping: focusError.rawValue)
      }
      return finish(.none)
    }
    let focused = focusedValue as! AXUIElement
    AXUIElementSetMessagingTimeout(focused, Self.messagingTimeout)
    let secure = kAXSecureTextFieldSubrole as String
    let role: String? = Self.copy(focused, kAXRoleAttribute)
    let subrole: String? = Self.copy(focused, kAXSubroleAttribute)
    if role == secure || subrole == secure {
      trace.roleCode = 8
      trace.lastAxError = 0
      return finish(.secureField)
    }

    let surface = SelectionSurface(focused)
    trace.roleCode = Self.encodeRole(role)
    trace.webAttrsMask = Self.encodeSurfaceMask(surface)

    if let probe = SelectionTextProbe.probe(focused, surface: surface, in: app) {
      if probe != .none { trace.lastAxError = 0 }
      return finish(probe)
    }
    if let wps, let probe = WpsSelectionProbe.probe(app: app, evidence: wps) {
      trace.lastAxError = 0
      return finish(probe)
    }
    if let table = surface.selectedCellContainer() {
      if let origin, !gestureTargets(table, at: origin, in: app) { return finish(.none) }
      trace.lastAxError = 0
      return finish(.cells)
    }
    // Some editors focus a wrapper and expose the text selection on a child or ancestor.
    // Keep this search local and bounded, as SelectionReader does for an explicit read.
    let deadline = ContinuousClock.now + .milliseconds(150)
    let children: [AXUIElement] = Self.copy(focused, kAXChildrenAttribute) ?? []
    for child in children.prefix(20) where ContinuousClock.now < deadline {
      if let probe = SelectionTextProbe.probe(child, in: app) {
        if probe != .none { trace.lastAxError = 0 }
        return finish(probe)
      }
    }
    var current = focused
    for _ in 0..<6 where ContinuousClock.now < deadline {
      guard let parent: AXUIElement = Self.copy(current, kAXParentAttribute) else { break }
      let parentRole: String? = Self.copy(parent, kAXRoleAttribute)
      if parentRole == kAXWindowRole || parentRole == kAXApplicationRole { break }
      if let probe = SelectionTextProbe.probe(parent, in: app) {
        if probe != .none { trace.lastAxError = 0 }
        return finish(probe)
      }
      current = parent
    }
    let fallback: SelectionProbe =
      surface.opaqueEditor && SelectionEditMenu(focused)?.hasSelection == true
      ? .unmeasured : .none
    if fallback != .none { trace.lastAxError = 0 }
    return finish(fallback)
  }

  /// Clicking blank space or a menu can leave another view focused. Its retained cell
  /// selection is not evidence about this gesture; require its start to hit the same table.
  private func gestureTargets(_ table: AXUIElement, at pointer: CGPoint, in app: AXUIElement)
    -> Bool
  {
    var hit: AXUIElement?
    guard
      AXUIElementCopyElementAtPosition(app, Float(pointer.x), Float(pointer.y), &hit) == .success,
      var current = hit
    else { return false }
    let deadline = ContinuousClock.now + .milliseconds(150)
    while ContinuousClock.now < deadline {
      if CFEqual(current, table) { return true }
      AXUIElementSetMessagingTimeout(current, Self.messagingTimeout)
      let role: String? = Self.copy(current, kAXRoleAttribute)
      if role == kAXWindowRole || role == kAXApplicationRole { return false }
      guard let parent: AXUIElement = Self.copy(current, kAXParentAttribute) else { return false }
      current = parent
    }
    return false
  }

  /// Asks the application for its `AXRole` so Chromium/Electron wake their basic web AX tree.
  @discardableResult
  static func wakeWebContent(_ app: AXUIElement) -> AXError {
    var role: CFTypeRef?
    return AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &role)
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
    else { return nil }
    return value as? T
  }

  private static func isAbnormalAxError(_ error: AXError) -> Bool {
    switch error {
    case .apiDisabled, .cannotComplete, .failure, .invalidUIElement, .notImplemented:
      true
    default:
      false
    }
  }

  static func encodeRole(_ role: String?) -> UInt8 {
    guard let role else { return 0 }
    return switch role {
    case kAXTextFieldRole: 1
    case kAXTextAreaRole: 2
    case "AXWebArea": 3
    case kAXStaticTextRole: 4
    case kAXComboBoxRole: 5
    case kAXTableRole: 6
    case kAXGroupRole, kAXSplitGroupRole, "AXLayoutArea": 7
    case kAXSecureTextFieldSubrole: 8
    default: 9
    }
  }

  static func roleName(forCode code: UInt8) -> String? {
    switch code {
    case 0: nil
    case 1: kAXTextFieldRole
    case 2: kAXTextAreaRole
    case 3: "AXWebArea"
    case 4: kAXStaticTextRole
    case 5: kAXComboBoxRole
    case 6: kAXTableRole
    case 7: kAXGroupRole
    case 8: kAXSecureTextFieldSubrole
    default: "AXElement"
    }
  }

  private static func encodeSurfaceMask(_ surface: SelectionSurface) -> UInt8 {
    var mask: UInt8 = 0
    if surface.advertisesTextRange { mask |= 1 << 0 }
    if surface.attributes.contains("AXSelectedTextMarkerRange") { mask |= 1 << 1 }
    if surface.attributes.contains("AXDOMClassList")
      || surface.attributes.contains("AXStartTextMarker")
    {
      mask |= 1 << 2
    }
    if surface.attributes.contains("AXSelectedCells") { mask |= 1 << 3 }
    if surface.opaqueEditor { mask |= 1 << 4 }
    return mask
  }
}

extension SelectionPresence {
  private nonisolated static let queue = DispatchQueue(
    label: "com.junerdd.ai.selection-presence", qos: .userInitiated)
  private nonisolated static let busy = Mutex(false)
  private nonisolated static let prepareQueue = DispatchQueue(
    label: "com.junerdd.ai.selection-prepare", qos: .utility)

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

  nonisolated static func wake(pid: pid_t) {
    prepareQueue.async {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, messagingTimeout)
      wakeWebContent(app)
    }
  }

  static func check(
    pid: pid_t, gestureAt origin: CGPoint, wps: WpsSelectionEvidence? = nil,
    limit: Duration = .milliseconds(300)
  ) async -> (probe: SelectionProbe, trace: SelectionProbeTrace) {
    let claimed = busy.withLock { busy in
      guard !busy else { return false }
      busy = true
      return true
    }
    guard claimed else {
      return (.none, SelectionProbeTrace(busyMutexSkipped: true))
    }
    let presence = SelectionPresence(pid: pid)
    let timeoutTrace = SelectionProbeTrace(
      lastAxError: Int16(clamping: AXError.cannotComplete.rawValue),
      elapsedUs: UInt16.max)
    return await Deadline.value(within: limit, fallback: (.none, timeoutTrace)) {
      await withCheckedContinuation { continuation in
        queue.async {
          let outcome = presence.probe(gestureAt: origin, wps: wps)
          busy.withLock { $0 = false }
          continuation.resume(returning: outcome)
        }
      }
    }
  }
}
