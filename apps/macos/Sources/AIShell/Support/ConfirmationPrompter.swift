import AppKit

/// A native confirmation the page cannot answer: a warning `NSAlert` with its buttons in order.
/// `Choice` is what each button means to the caller.
struct ConfirmationPrompt<Choice: Sendable>: Sendable {
  struct Button: Sendable {
    let title: String
    let choice: Choice
    /// Return answers it.
    var isDefault = false
    /// Escape answers it.
    var isCancel = false
    /// Drawn as a destructive action.
    var isDestructive = false
  }

  let title: String
  let message: String
  let buttons: [Button]
  /// Shown below the message in a read-only, scrollable monospaced view.
  var detail: String?
}

/// Shows security confirmations one at a time, app-modally, through ``NestedRunLoop`` so main
/// actor tasks keep running while one is open. A request made while another confirmation is
/// open gets no answer (`nil`) instead of a queued dialog, so the page cannot stack prompts;
/// an alert aborted by an unattended quit answers `nil` too. Callers treat `nil` as a refusal.
@MainActor
final class ConfirmationPrompter {
  private(set) var isShowing = false

  func ask<Choice>(_ prompt: ConfirmationPrompt<Choice>) async -> Choice? {
    guard !isShowing, !prompt.buttons.isEmpty else { return nil }
    isShowing = true
    defer { isShowing = false }
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = prompt.title
    alert.informativeText = prompt.message
    if let detail = prompt.detail { alert.accessoryView = Self.detailView(detail) }
    for button in prompt.buttons {
      let control = alert.addButton(withTitle: button.title)
      // Only the declared buttons answer Return and Escape; NSAlert would otherwise make the
      // first button the default and match Cancel by its English title.
      control.keyEquivalent = button.isDefault ? "\r" : button.isCancel ? "\u{1b}" : ""
      control.hasDestructiveAction = button.isDestructive
    }
    // A button that answers both keys holds Return; Escape reaches it through a monitor.
    let escape = prompt.buttons.firstIndex { $0.isCancel && $0.isDefault }.flatMap { index in
      Self.escapeMonitor(clicking: alert.buttons[index])
    }
    defer { if let escape { NSEvent.removeMonitor(escape) } }
    // A menu bar app is often not frontmost when the page asks.
    NSApp.activate()
    let response = await NestedRunLoop.runModal(alert)
    let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    return prompt.buttons.indices.contains(index) ? prompt.buttons[index].choice : nil
  }

  /// Escape in the alert clicks `button`.
  private static func escapeMonitor(clicking button: NSButton) -> Any? {
    NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak button] event in
      guard event.keyCode == 53, let button, event.window === button.window else { return event }
      button.performClick(nil)
      return nil
    }
  }

  /// The detail as selectable monospaced text, wrapped to the alert and scrolling beyond
  /// ``detailMaxHeight``.
  private static func detailView(_ text: String) -> NSView {
    let scroll = NSScrollView(
      frame: NSRect(x: 0, y: 0, width: detailWidth, height: detailMaxHeight))
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    scroll.borderType = .bezelBorder
    let size = scroll.contentSize
    let view = NSTextView(frame: NSRect(origin: .zero, size: size))
    view.isEditable = false
    view.isSelectable = true
    view.isRichText = false
    view.font = .monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
    view.textContainerInset = NSSize(width: 4, height: 4)
    view.isVerticallyResizable = true
    view.autoresizingMask = [.width]
    view.textContainer?.widthTracksTextView = true
    view.string = text
    scroll.documentView = view
    var height = view.textContainerInset.height * 2
    if let layout = view.layoutManager, let container = view.textContainer {
      layout.ensureLayout(for: container)
      height += layout.usedRect(for: container).height
    }
    let border = scroll.frame.height - size.height
    scroll.setFrameSize(NSSize(width: detailWidth, height: min(height, detailMaxHeight) + border))
    return scroll
  }

  private static let detailWidth: CGFloat = 440
  private static let detailMaxHeight: CGFloat = 220
}
