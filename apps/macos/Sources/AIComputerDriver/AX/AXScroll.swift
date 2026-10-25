import AIComputerDriverKit
import ApplicationServices
import Foundation

/// Semantic scrolling: reveal an element or page a scrollable region without a wheel event or a
/// pointer. `toVisible` uses `AXScrollToVisible`; the page kinds use the `AXScroll*ByPage`
/// actions. Throws `noRoute` when the element does not support the requested scroll.
enum AXScroll {
  static func scroll(_ element: AXUIElement, _ kind: DriverScrollKind) throws {
    let action: String
    switch kind {
    case .toVisible: action = "AXScrollToVisible"
    case .pageUp: action = "AXScrollUpByPage"
    case .pageDown: action = "AXScrollDownByPage"
    case .pageLeft: action = "AXScrollLeftByPage"
    case .pageRight: action = "AXScrollRightByPage"
    }
    let error = AXUIElementPerformAction(element, action as CFString)
    guard error == .success else {
      throw DriverFailure(
        code: .noRoute, message: "AX scroll \(action) failed (AXError \(error.rawValue))")
    }
  }
}
