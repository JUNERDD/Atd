import AtdKeyboardCore
import UIKit

/// The host field, through the controller's text document proxy.
final class ProxyDocument: DocumentEditor {
  private weak var controller: UIInputViewController?
  /// Stands in for the field's identifier if the controller is gone, so nothing matches it.
  private let detached = UUID()

  init(_ controller: UIInputViewController) {
    self.controller = controller
  }

  private var proxy: (any UITextDocumentProxy)? { controller?.textDocumentProxy }

  var contextBeforeInput: String? { proxy?.documentContextBeforeInput }
  var contextAfterInput: String? { proxy?.documentContextAfterInput }
  var selectedText: String? { proxy?.selectedText }
  var hasText: Bool { proxy?.hasText ?? false }
  var documentIdentifier: UUID { proxy?.documentIdentifier ?? detached }

  func insertText(_ text: String) {
    proxy?.insertText(text)
  }

  func deleteBackward() {
    proxy?.deleteBackward()
  }

  func moveCursor(by offset: Int) {
    proxy?.adjustTextPosition(byCharacterOffset: offset)
  }

  func setMarkedText(_ text: String) {
    proxy?.setMarkedText(text, selectedRange: NSRange(location: text.utf16.count, length: 0))
  }

  func unmarkText() {
    proxy?.unmarkText()
  }
}

/// The general pasteboard. Only reading its text can show the system's paste prompt.
final class SystemClipboard: Clipboard {
  var changeCount: Int { UIPasteboard.general.changeCount }
  var hasText: Bool { UIPasteboard.general.hasStrings }

  func readText() -> String? {
    UIPasteboard.general.string
  }
}
