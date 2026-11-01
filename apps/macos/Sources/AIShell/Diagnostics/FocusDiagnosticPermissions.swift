import AICore
import AppKit
import ApplicationServices

/// Prepare once before reproduction; never interrupt a shortcut or a click to ask for access.
final class FocusDiagnosticPermissions {
  private let trust: AccessibilityTrust
  private var started = false
  private var askedForInput = false
  private var previousState: [Bool] = []

  init(trust: AccessibilityTrust) { self.trust = trust }

  func request(automatic: Bool, mouseTapActive: Bool) {
    guard !automatic || !started else { return }
    started = true
    if !AXIsProcessTrusted() {
      FocusDiagnostics.shared.record(
        "permissions.request", details: ["kind": .string("accessibility")])
      trust.openSystemSettings()
    } else if !mouseTapActive {
      requestInput(openSettings: !automatic)
    }
  }

  func refresh(mouseTapActive: Bool) {
    let state = [AXIsProcessTrusted(), CGPreflightListenEventAccess(), mouseTapActive]
    if state != previousState {
      previousState = state
      FocusDiagnostics.shared.record(
        "permissions.changed",
        details: [
          "accessibility": .bool(state[0]), "inputMonitoring": .bool(state[1]),
          "mouseTapActive": .bool(state[2]),
        ])
    }
    // Accessibility normally suffices for a mouse-only tap. Ask for Input Monitoring only
    // when the tap still cannot start, after the Accessibility guide has finished.
    if started, state[0], trust.isTrusted, !state[2], !state[1], !askedForInput {
      requestInput(openSettings: false)
    }
  }

  private func requestInput(openSettings: Bool) {
    if !askedForInput, !CGPreflightListenEventAccess() {
      askedForInput = true
      FocusDiagnostics.shared.record(
        "permissions.request", details: ["kind": .string("inputMonitoring")])
      CGRequestListenEventAccess()
    }
    if openSettings,
      let url = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
    {
      NSWorkspace.shared.open(url)
    }
  }
}
