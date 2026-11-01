import AICore
import AppKit
import ApplicationServices

/// Passive monitors: always forward events; never request permissions, focus or a synthetic click.
final class FocusDiagnosticMonitoring {
  private var observers: [any NSObjectProtocol] = []
  private var local: Any?
  private var global: Any?
  private var tap: CFMachPort?
  private var source: CFRunLoopSource?
  private(set) var coverage: [String: JSONValue] = [:]
  private var lastTapAccess: [Bool] = []

  var tapActive: Bool { tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false }

  func refreshPermission() {
    let access = [CGPreflightListenEventAccess(), AXIsProcessTrusted()]
    if access.contains(true), access != lastTapAccess {
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) } else { installTap() }
    }
    lastTapAccess = access
    coverage["sessionMouseTap"] = .bool(tapActive)
  }

  func start() {
    let mask: NSEvent.EventTypeMask = [
      .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
    ]
    local = NSEvent.addLocalMonitorForEvents(matching: mask) { event in
      MainActor.assumeIsolated { FocusDiagnostics.shared.mouse(event, stage: "mouse.local") }
      return event
    }
    global = NSEvent.addGlobalMonitorForEvents(matching: mask) { event in
      MainActor.assumeIsolated { FocusDiagnostics.shared.mouse(event, stage: "mouse.global") }
    }
    coverage["localMouseMonitor"] = .bool(local != nil)
    coverage["globalMouseMonitor"] = .bool(global != nil)
    installTap()
    let center = NotificationCenter.default
    for name in [
      NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
      NSApplication.didHideNotification, NSApplication.didUnhideNotification,
      NSApplication.didChangeScreenParametersNotification,
      NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
      NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
      NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
      NSWindow.didDeminiaturizeNotification, NSWindow.willCloseNotification,
    ] {
      observe(name, on: center)
    }
    let workspace = NSWorkspace.shared.notificationCenter
    for name in [
      NSWorkspace.didActivateApplicationNotification,
      NSWorkspace.didDeactivateApplicationNotification,
      NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.didWakeNotification,
      NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification,
      NSWorkspace.screensDidWakeNotification,
    ] {
      observe(name, on: workspace)
    }
  }

  private func observe(_ name: Notification.Name, on center: NotificationCenter) {
    observers.append(
      center.addObserver(forName: name, object: nil, queue: .main) { note in
        let window = note.object as? NSWindow
        let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?
          .processIdentifier
        MainActor.assumeIsolated {
          var details: [String: JSONValue] = ["name": .string(name.rawValue)]
          if let window {
            details["windowNumber"] = .number(Double(window.windowNumber))
          }
          if let pid {
            details["pid"] = .number(Double(pid))
            details["application"] = FocusDiagnosticSnapshot.application(
              NSRunningApplication(processIdentifier: pid))
          }
          FocusDiagnostics.shared.record("notification", details: details)
        }
      })
  }

  private func installTap() {
    let allowed = CGPreflightListenEventAccess() || AXIsProcessTrusted()
    lastTapAccess = [CGPreflightListenEventAccess(), AXIsProcessTrusted()]
    coverage["tapPermissionPresent"] = .bool(allowed)
    guard allowed else {
      coverage["sessionMouseTap"] = .bool(false)
      return
    }
    let types: [CGEventType] = [
      .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
      .otherMouseDown, .otherMouseUp,
    ]
    let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
    tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .tailAppendEventTap,
      options: .listenOnly, eventsOfInterest: mask,
      callback: { _, type, event, _ in
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
          let reason = type == .tapDisabledByTimeout ? "timeout" : "userInput"
          Task { @MainActor in FocusDiagnostics.shared.tapDisabled(reason: reason) }
          return Unmanaged.passUnretained(event)
        }
        let details: [String: JSONValue] = [
          "type": .number(Double(type.rawValue)), "timestampNs": .number(Double(event.timestamp)),
          "quartzLocation": .array([.number(event.location.x), .number(event.location.y)]),
          "windowUnderPointer": .number(
            Double(event.getIntegerValueField(.mouseEventWindowUnderMousePointer))),
          "receiverHint": .number(
            Double(
              event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent))),
          "targetPID": .number(Double(event.getIntegerValueField(.eventTargetUnixProcessID))),
        ]
        // Copy only scalar mouse facts before leaving the callback; no CGEvent crosses actors.
        Task { @MainActor in
          FocusDiagnostics.shared.record("mouse.tap", details: details)
        }
        return Unmanaged.passUnretained(event)
      }, userInfo: nil)
    coverage["sessionMouseTap"] = .bool(tap != nil)
    if let tap {
      source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
      CGEvent.tapEnable(tap: tap, enable: true)
    }
  }

  func tapDisabled(reason: String) {
    if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    let enabled = tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false
    coverage["sessionMouseTap"] = .bool(enabled)
    FocusDiagnostics.shared.record(
      "monitor.tapDisabled", details: ["reason": .string(reason), "reenabled": .bool(enabled)])
  }
}
