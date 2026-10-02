import WebKit

/// The two private WebKit settings the shell relies on (decision R5). Neither has a public
/// equivalent. Both are applied through key-value coding, which raises an Objective-C exception on
/// an unknown key, so each is set only when WebKit still answers the setter; a WebKit without it
/// keeps the public behavior (an opaque page, or the CSS glass fallback) instead of crashing.
public enum WebKitPrivate {
  /// Lets pages use `-apple-visual-effect: -apple-system-glass-material`, WebKit's in-page system
  /// glass (spike S5). Without it `CSS.supports` reports the property unsupported and
  /// `surface-glass` renders its translucent-fill fallback.
  @discardableResult
  public static func enableSystemAppearance(_ preferences: WKPreferences) -> Bool {
    set(true, forKey: "useSystemAppearance", setter: "_setUseSystemAppearance:", on: preferences)
  }

  /// Stops the web view painting its own background, so the window's `NSGlassEffectView` shows
  /// through a transparent page.
  @discardableResult
  public static func disableBackground(_ webView: WKWebView) -> Bool {
    set(false, forKey: "drawsBackground", setter: "_setDrawsBackground:", on: webView)
  }

  /// `setter` is the selector key-value coding resolves `key` to; WebKit implements these keys
  /// only as underscored setters (`_set<Key>:`), which KVC also searches.
  private static func set(
    _ value: Bool, forKey key: String, setter: String, on object: NSObject
  ) -> Bool {
    guard object.responds(to: NSSelectorFromString(setter)) else { return false }
    object.setValue(value, forKey: key)
    return true
  }
}
