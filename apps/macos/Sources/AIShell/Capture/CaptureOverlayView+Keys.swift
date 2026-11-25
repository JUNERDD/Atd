import AppKit

/// Identifies synthesized keyboard events that must not trigger unsolicited capture or pinned-image
/// copy actions.
///
/// Two narrow classes are filtered:
/// - Atd's own ``KeyPress/post(_:flags:)`` events (`eventSourceUserData == "ATDKEYPR"`), which
///   target other apps and must never drive Atd's own capture overlays, popovers, or pins.
/// - External user-space synthetic `⌘C` (`CGEventPost` / `CGEventPostToPid` with a non-zero
///   `.eventSourceUnixProcessID` belonging to another process, such as PopClip, Bob, or Easydict
///   probing pasteboard text after a mouse drag), when no `NSTextView` has an active text
///   selection to copy.
///
/// Physical HID and DriverKit virtual HID keyboards (`pid == 0`), in-process `NSEvent.keyEvent`
/// test events (`pid == self`, `userData == 0`), remote-desktop navigation/cancel/editing keys,
/// external `⌘V` clipboard/snippet paste into editable fields, and `⌘C` copying selected text in
/// `ResultTextView` / text editors all pass cleanly.
enum CaptureKeyEventFilter {
  /// Matches ``KeyPress``'s `"ATDKEYPR"` `eventSourceUserData` marker.
  private nonisolated static let atdKeyPressMarker: Int64 = 0x4154_444B_4559_5052
  private nonisolated static let selfPID = Int64(ProcessInfo.processInfo.processIdentifier)

  nonisolated static func isOwnSynthesizedKey(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown || event.type == .keyUp || event.type == .flagsChanged else {
      return false
    }
    guard let cgEvent = event.cgEvent else { return false }
    return cgEvent.getIntegerValueField(.eventSourceUserData) == atdKeyPressMarker
  }

  nonisolated static func isExternalSyntheticCopy(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown else { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard modifiers == .command, event.charactersIgnoringModifiers?.lowercased() == "c",
      let cgEvent = event.cgEvent
    else { return false }
    let sourcePID = cgEvent.getIntegerValueField(.eventSourceUnixProcessID)
    return sourcePID != 0 && sourcePID != selfPID
  }

  /// True when `responder` is an `NSTextView` with a non-empty text selection that owns `⌘C`.
  static func firstResponderHasTextSelection(_ responder: NSResponder?) -> Bool {
    guard let textView = responder as? NSTextView else { return false }
    return textView.selectedRange().length > 0
  }

  /// True when a capture overlay should consume `event` in `performKeyEquivalent` ahead of views
  /// and `NSApp.mainMenu` without triggering screenshot copy or a system beep.
  static func shouldSwallowCaptureKeyEquivalent(
    _ event: NSEvent, firstResponder: NSResponder?
  ) -> Bool {
    if isOwnSynthesizedKey(event) { return true }
    return isExternalSyntheticCopy(event) && !firstResponderHasTextSelection(firstResponder)
  }

  /// True when a pinned screenshot window (no selectable text) should consume `event` silently.
  nonisolated static func shouldSwallowPinnedKey(_ event: NSEvent) -> Bool {
    isOwnSynthesizedKey(event) || isExternalSyntheticCopy(event)
  }
}

/// Keyboard and responder-chain command handling for ``CaptureOverlayView``.
extension CaptureOverlayView {
  /// Pressing or releasing Shift/Option mid-drag reshapes the selection without a mouse move.
  override func flagsChanged(with event: NSEvent) {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return }
    if let dragPoint { sendDrag(to: dragPoint, flags: event.modifierFlags, ended: false) }
    super.flagsChanged(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if CaptureKeyEventFilter.shouldSwallowCaptureKeyEquivalent(
      event, firstResponder: window?.firstResponder)
    {
      return true
    }
    if super.performKeyEquivalent(with: event) { return true }
    if let editor = window?.firstResponder as? NSTextView,
      editor.hasMarkedText() || editor.isFieldEditor
    {
      return false
    }
    guard event.type == .keyDown, window?.isKeyWindow == true,
      let command = CaptureCommand(event), command == .save || command == .pin
    else { return false }
    delegate?.overlay(self, perform: command)
    return true
  }

  override func keyDown(with event: NSEvent) {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return }
    if event.keyCode == 49, let dragPoint {
      if !isSpacePanning {
        isSpacePanning = true
        delegate?.overlay(self, spacePanChanged: true, at: dragPoint)
      }
      return
    }
    if [49, 13].contains(event.keyCode), event.isARepeat { return }
    guard let command = CaptureCommand(event) else {
      super.keyDown(with: event)
      return
    }
    delegate?.overlay(self, perform: command)
  }

  override func keyUp(with event: NSEvent) {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return }
    if event.keyCode == 49, isSpacePanning {
      isSpacePanning = false
      delegate?.overlay(self, spacePanChanged: false, at: dragPoint ?? .zero)
      return
    }
    super.keyUp(with: event)
  }

  /// Escape normally arrives in `keyDown`; this covers Command-period.
  override func cancelOperation(_ sender: Any?) { delegate?.overlay(self, perform: .cancel) }
  /// The Edit menu's Select All, when no text editor took it.
  override func selectAll(_ sender: Any?) { delegate?.overlay(self, perform: .selectDisplay) }
}
