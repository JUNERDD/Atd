import AIComputerDriverKit
import ApplicationServices
import Foundation

/// Inserts text through the AX channel: for Chromium/WebKit web inputs this produces trusted DOM
/// events (A2 conclusion 11), and for AppKit/SwiftUI fields it writes without a key change. When
/// a replacement range is given the writer selects it first (`AXSelectedTextRange`) and replaces
/// the selection (`AXSelectedText`); otherwise it inserts via `AXSelectedText` at the caret.
///
/// Insertion never falls back to rewriting the field's whole `AXValue`: that would destroy the
/// content around the caret, which is worse than refusing. When a needed attribute is not
/// settable the writer refuses `textUnavailable` before changing anything (selection included),
/// so `mayHaveDispatched` stays false and the host can take the next rung of its ladder.
enum AXTextWriter {
  /// Insert `text`, optionally replacing `range` (UTF-16 units). Throws `textUnavailable` when
  /// `AXSelectedText` (or, with a range, `AXSelectedTextRange`) is not settable or the write is
  /// rejected.
  static func insert(_ element: AXUIElement, text: String, range: DriverTextRange?) throws {
    guard AXActions.isSettable(element, kAXSelectedTextAttribute as String) else {
      throw DriverFailure(
        code: .textUnavailable,
        message: "AXSelectedText is not settable; refusing instead of replacing the whole value")
    }
    if let range {
      guard AXActions.isSettable(element, kAXSelectedTextRangeAttribute as String) else {
        throw DriverFailure(
          code: .textUnavailable, message: "AXSelectedTextRange is not settable on this element")
      }
      try select(element, range: range)
    }
    let error = AXUIElementSetAttributeValue(
      element, kAXSelectedTextAttribute as CFString, text as CFString)
    guard error == .success else {
      throw DriverFailure(
        code: .textUnavailable, message: "AXSelectedText write failed (AXError \(error.rawValue))")
    }
  }

  private static func select(_ element: AXUIElement, range: DriverTextRange) throws {
    var cfRange = CFRange(location: range.location, length: range.length)
    guard let value = AXValueCreate(.cfRange, &cfRange) else {
      throw DriverFailure(code: .textUnavailable, message: "could not build AX range value")
    }
    let error = AXUIElementSetAttributeValue(
      element, kAXSelectedTextRangeAttribute as CFString, value)
    guard error == .success else {
      throw DriverFailure(
        code: .textUnavailable,
        message: "AXSelectedTextRange write failed (AXError \(error.rawValue))")
    }
  }
}
