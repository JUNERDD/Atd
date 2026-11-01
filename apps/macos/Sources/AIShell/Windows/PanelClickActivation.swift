import AppKit
import ObjectiveC

/// Keeps the task panel's non-activating keyboard summons while letting WindowServer handle a
/// genuine mouse press as an activating click. AppKit's style mask controls keyboard borrowing;
/// its separate server tag suppresses mouse activation.
/// The public style-mask setter does not reliably synchronize that tag, so leave the mask intact.
/// Mechanism: https://philz.blog/nspanel-nonactivating-style-mask-flag/
/// The guarded selector is also used by akiflow/electron-panel-window's functions_mac.mm.
enum PanelClickActivation {
  /// Returns whether the private setter could be called with its declared scalar ABI. A missing
  /// or changed method leaves the panel's existing mouse-down activation fallback in place.
  static func configure(_ panel: NSPanel) -> Bool {
    let selector = NSSelectorFromString("_setPreventsActivation:")
    guard panel.responds(to: selector),
      let method = class_getInstanceMethod(type(of: panel), selector),
      method_getNumberOfArguments(method) == 3,
      encoding(method) == "v", encoding(method, argument: 0) == "@",
      encoding(method, argument: 1) == ":"
    else { return false }

    let implementation = method_getImplementation(method)
    // Objective-C BOOL is bool on arm64 and signed char on Intel. Match the actual method,
    // rather than passing an object through perform(_:with:) or assuming one architecture's ABI.
    switch encoding(method, argument: 2) {
    case "B":
      typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
      unsafeBitCast(implementation, to: Setter.self)(panel, selector, false)
    case "c":
      typealias Setter = @convention(c) (AnyObject, Selector, Int8) -> Void
      unsafeBitCast(implementation, to: Setter.self)(panel, selector, 0)
    default:
      return false
    }
    return true
  }

  private static func encoding(_ method: Method, argument: UInt32? = nil) -> String? {
    let value: UnsafeMutablePointer<CChar>?
    if let argument {
      value = method_copyArgumentType(method, argument)
    } else {
      value = method_copyReturnType(method)
    }
    guard let value else { return nil }
    defer { free(value) }
    return String(cString: value)
  }
}
