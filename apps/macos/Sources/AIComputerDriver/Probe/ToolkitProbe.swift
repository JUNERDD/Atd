import AIComputerDriverKit
import AppKit
import ApplicationServices
import Foundation

/// Classifies a target window's UI toolkit so the host can choose and gate routes: refuse
/// `pointer` on an opaque Metal/GL surface, take the Chromium click recipe on Chromium, and so
/// on. Detection is by the frameworks the app ships plus the shape of its AX subtree, never a
/// bundle-id list (plan §4.1). The native AppKit/SwiftUI split is not cheaply observable, so both
/// report as `appKit`; the host treats them the same for routing.
enum ToolkitProbe {
  /// Classify the toolkit and report whether a web-accessibility area is present under `window`.
  static func classify(pid: pid_t, window: AXUIElement) -> (toolkit: DriverToolkit, webArea: Bool) {
    let frameworks = frameworkNames(pid: pid)
    let webArea = WebAccessibility.containsWebArea(window)

    if frameworks.contains(where: { $0.contains("electron") }) {
      return (.electron, webArea)
    }
    if frameworks.contains(where: {
      $0.contains("chromiumembedded") || $0 == "cef" || $0.contains("chromium embedded")
    }) {
      return (.cef, webArea)
    }
    if frameworks.contains(where: { $0.contains("chrom") }) {
      return (.chromium, webArea)
    }
    if frameworks.contains(where: { $0.hasPrefix("flutter") }) {
      return (.flutter, webArea)
    }
    if frameworks.contains(where: { $0.hasPrefix("qt") || $0.contains("libqt") }) {
      return (.qt, hasChildren(window) ? webArea : false)
    }
    if frameworks.contains(where: {
      $0.contains("jre") || $0.contains("libjvm") || $0.contains("jdk")
    }) {
      return (.java, webArea)
    }
    if isCatalyst(pid: pid) {
      return (.catalyst, webArea)
    }
    if webArea {
      return (.webKit, true)
    }
    // No shipped web/native-foreign framework: a window with an AX subtree is native AppKit/
    // SwiftUI; one with no usable subtree is an opaque surface (Metal/GL/game) — a hard wall.
    return hasUsableSubtree(window) ? (.appKit, false) : (.opaque, false)
  }

  private static func frameworkNames(pid: pid_t) -> [String] {
    guard let bundleURL = NSRunningApplication(processIdentifier: pid)?.bundleURL else { return [] }
    let frameworks = bundleURL.appendingPathComponent("Contents/Frameworks")
    let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworks.path)) ?? []
    return names.map { $0.lowercased() }
  }

  /// Catalyst and iOS-on-Mac apps carry `UIDeviceFamily` in their Info.plist; AppKit apps do not.
  private static func isCatalyst(pid: pid_t) -> Bool {
    guard let bundleURL = NSRunningApplication(processIdentifier: pid)?.bundleURL,
      let info = Bundle(url: bundleURL)?.infoDictionary
    else { return false }
    return info["UIDeviceFamily"] != nil
  }

  private static func hasChildren(_ window: AXUIElement) -> Bool {
    !AXBindings.copyElements(window, kAXChildrenAttribute as String).isEmpty
  }

  /// A window has a usable subtree when it exposes any descendant that advertises an action or a
  /// role beyond a bare container within the first couple of levels.
  private static func hasUsableSubtree(_ window: AXUIElement, depth: Int = 0) -> Bool {
    if depth > 3 { return false }
    for child in AXBindings.copyElements(window, kAXChildrenAttribute as String) {
      if !AXBindings.actionNames(child).isEmpty { return true }
      if let role = AXBindings.copyString(child, kAXRoleAttribute as String),
        role != "AXGroup", role != "AXUnknown", role != "AXLayoutArea"
      {
        return true
      }
      if hasUsableSubtree(child, depth: depth + 1) { return true }
    }
    return false
  }
}
