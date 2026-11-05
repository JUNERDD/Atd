import AppKit
import WebKit

@testable import AIShell

/// Fixture-only focus behavior from d48047ff^: the panel activates on every direct click and
/// ShellWebView inherits WebKit's acceptsFirstMouse policy. Drops and paste are irrelevant to
/// this fixed document and are deliberately excluded. Current modes use the real product types.
@MainActor
final class LegacyFocusPanel: NSPanel {
  override var canBecomeKey: Bool {
    alphaValue > 0 && !ignoresMouseEvents && !isMiniaturized
  }
  override var canBecomeMain: Bool { false }

  override func sendEvent(_ event: NSEvent) {
    switch event.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      if canBecomeKey { NSApp.activate() }
    default: break
    }
    super.sendEvent(event)
  }
}

@MainActor
final class LegacyFocusWebView: WindowDraggingWebView {
  private(set) var lastMouseDown: NSEvent?

  override func mouseDown(with event: NSEvent) {
    lastMouseDown = event
    super.mouseDown(with: event)
  }
}
