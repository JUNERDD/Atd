import AIComputerDriverKit
import AppKit
import ApplicationServices
import Foundation

/// Turns on an app's web-accessibility tree so background AX actions reach web content. Chromium,
/// Electron and CEF build the web tree lazily after the first assistive request; they are
/// detected by the frameworks they ship, not a bundle-id list (plan §4.1; A3 conclusion 16).
/// `AXManualAccessibility` is the clean modern attribute; `AXEnhancedUserInterface` is the legacy
/// fallback and has observable side effects, so it is only set when the modern one is unsupported.
enum WebAccessibility {
  private static let webAreaRole = "AXWebArea"
  private static let treeWait: TimeInterval = 3.0
  private static let pollInterval: TimeInterval = 0.1

  /// Whether the app ships a Chromium/Electron/CEF framework and therefore builds its web tree
  /// lazily (so enablement must be followed by a wait). WebKit hosts expose their web area at once.
  static func hasLazyWebTree(pid: pid_t) -> Bool {
    guard let bundleURL = NSRunningApplication(processIdentifier: pid)?.bundleURL else {
      return false
    }
    let frameworks = bundleURL.appendingPathComponent("Contents/Frameworks")
    let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworks.path)) ?? []
    return names.contains { name in
      let lowered = name.lowercased()
      return lowered.contains("chrom") || lowered.contains("electron") || lowered.contains("cef")
    }
  }

  /// Enable the web tree and, for a lazy engine that took the attribute, wait up to 3s for an
  /// `AXWebArea` to appear under the window. An app that took neither attribute is not waited
  /// for: nothing was turned on, so no tree is coming.
  static func enable(appElement: AXUIElement, window: AXUIElement, pid: pid_t)
    -> DriverWebAccessibilityOutcome
  {
    let took =
      AXUIElementSetAttributeValue(
        appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
      || AXUIElementSetAttributeValue(
        appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) == .success
    let missing: DriverWebAccessibilityOutcome = took ? .noWebArea : .refused
    guard took, hasLazyWebTree(pid: pid) else {
      return containsWebArea(window) ? .webArea : missing
    }
    let deadline = Date().addingTimeInterval(treeWait)
    while Date() < deadline {
      if containsWebArea(window) { return .webArea }
      Thread.sleep(forTimeInterval: pollInterval)
    }
    return containsWebArea(window) ? .webArea : missing
  }

  /// Whether an `AXWebArea` exists in the first few levels of the window's subtree.
  static func containsWebArea(_ element: AXUIElement, depth: Int = 0) -> Bool {
    if depth > 6 { return false }
    if AXBindings.copyString(element, kAXRoleAttribute as String) == webAreaRole { return true }
    for child in AXBindings.copyElements(element, kAXChildrenAttribute as String) {
      if containsWebArea(child, depth: depth + 1) { return true }
    }
    return false
  }
}
