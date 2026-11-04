import AICore
import AppKit
import ApplicationServices
import Testing

@testable import AIShell

/// Exercises the real AX client against an AppKit accessibility provider in this process.
/// The fixture owns only its window; it neither activates another app nor needs user data.
@MainActor
@Suite(
  "Selection presence through Accessibility", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct SelectionPresenceTests {
  @Test("A selected table is accepted even when hit testing lands twelve wrappers below its cell")
  func deepCell() async throws {
    let fixture = SelectionAXFixture(role: .table, depth: 12)
    defer { fixture.close() }
    try await fixture.ready()
    #expect(await probe(at: fixture.cellPoint) == .cells)
  }

  @Test("Blank space does not inherit the focused table's retained selection")
  func blankSpace() async throws {
    let fixture = SelectionAXFixture(role: .table)
    defer { fixture.close() }
    try await fixture.ready()
    #expect(await probe(at: fixture.cellPoint) == .cells)
    #expect(await probe(at: fixture.blankPoint) == .none)
    #expect(await probe(at: nil) == .cells)
  }

  @Test(
    "Lists, outlines and thumbnail grids with selected cells are not spreadsheet selections",
    arguments: [NSAccessibility.Role.list, .outline, .grid])
  func selectedItems(_ role: NSAccessibility.Role) async throws {
    let fixture = SelectionAXFixture(role: role)
    defer { fixture.close() }
    try await fixture.ready()
    #expect(await probe(at: fixture.cellPoint) == .none)
    #expect(await probe(at: nil) == .none)
  }

  private func probe(at point: CGPoint?) async -> SelectionProbe {
    let pid = getpid()
    return await Task.detached {
      SelectionPresence(pid: pid).probe(gestureAt: point)
    }.value
  }
}

@MainActor
private final class SelectionAXFixture {
  private static let application: NSApplication = {
    let app = NSApplication.shared
    app.finishLaunching()
    return app
  }()
  let window: NSWindow
  let table: SelectionAXTable
  let cellPoint: CGPoint
  let blankPoint: CGPoint
  private let identity = UUID().uuidString

  init(role: NSAccessibility.Role, depth: Int = 0) {
    _ = Self.application
    window = NSWindow(
      contentRect: CGRect(x: 100, y: 100, width: 500, height: 300),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Selection presence regression fixture"
    window.isReleasedWhenClosed = false
    table = SelectionAXTable(frame: CGRect(x: 20, y: 100, width: 250, height: 160))
    window.contentView?.addSubview(table)
    let frame = window.convertToScreen(table.convert(table.bounds, to: nil))
    table.configure(role: role, frame: frame, depth: depth, identity: identity)
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(table)
    let height = NSScreen.screens.first?.frame.height ?? 0
    cellPoint = CaptureCoordinates.flip(
      CGPoint(x: frame.midX, y: frame.midY), primaryHeight: height)
    blankPoint = CaptureCoordinates.flip(
      window.convertPoint(toScreen: CGPoint(x: 400, y: 40)), primaryHeight: height)
  }

  /// AppKit publishes windows and invalidates old hit-test entries asynchronously. Wait for
  /// this fixture's identity and selected-cell evidence, not for the production decision.
  func ready() async throws {
    let pid = getpid()
    let point = cellPoint
    let identity = identity
    // The first AX publication shares the main thread with concurrent SwiftUI layout tests.
    // Allow CI startup contention without relaxing either the identity or selection checks.
    let deadline = ContinuousClock.now + .seconds(10)
    while ContinuousClock.now < deadline {
      let ready = await Task.detached { Self.isReady(pid: pid, point: point, identity: identity) }
        .value
      if ready { return }
      try await Task.sleep(for: .milliseconds(20))
    }
    Issue.record("The fixture did not publish its AX hit target and selected cells")
    throw FixtureError.notReady
  }

  private enum FixtureError: Error { case notReady }

  private nonisolated static func isReady(pid: pid_t, point: CGPoint, identity: String) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
      let hit
    else { return false }
    var identifier: CFTypeRef?
    AXUIElementCopyAttributeValue(hit, kAXIdentifierAttribute as CFString, &identifier)
    guard identifier as? String == identity else { return false }
    var focused: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
        == .success,
      let focused, CFGetTypeID(focused) == AXUIElementGetTypeID()
    else { return false }
    var parent: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(
        focused as! AXUIElement, kAXParentAttribute as CFString, &parent) == .success,
      let parent, CFGetTypeID(parent) == AXUIElementGetTypeID()
    else { return false }
    var count: CFIndex = 0
    return AXUIElementGetAttributeValueCount(
      parent as! AXUIElement, "AXSelectedCells" as CFString, &count) == .success && count == 1
  }

  func close() { window.close() }
}

@MainActor
private final class SelectionAXTable: NSView {
  // AppKit invokes these legacy AX callbacks on its main thread. Configure the graph before
  // showing the window; callbacks only read these retained endpoints.
  nonisolated(unsafe) private var cell: NSAccessibilityElement?
  nonisolated(unsafe) private var leaf: NSAccessibilityElement?

  override var acceptsFirstResponder: Bool { true }

  func configure(role: NSAccessibility.Role, frame: CGRect, depth: Int, identity: String) {
    setAccessibilityElement(true)
    setAccessibilityRole(role)
    let cell = NSAccessibilityElement()
    cell.setAccessibilityRole(.cell)
    cell.setAccessibilityFrame(frame)
    cell.setAccessibilityLabel("Selected cell")
    cell.setAccessibilityParent(self)
    cell.setAccessibilityFocused(true)
    cell.setAccessibilitySelected(true)
    self.cell = cell
    setAccessibilityChildren([cell])
    setAccessibilitySelectedCells([cell])
    var parent = cell
    for _ in 0..<depth {
      let child = NSAccessibilityElement()
      child.setAccessibilityRole(.group)
      child.setAccessibilityFrame(frame)
      child.setAccessibilityParent(parent)
      parent.setAccessibilityChildren([child])
      parent = child
    }
    parent.setAccessibilityIdentifier(identity)
    leaf = parent
  }

  override var accessibilityFocusedUIElement: Any? { cell }
  override func accessibilityHitTest(_ point: NSPoint) -> Any? { leaf }
}
