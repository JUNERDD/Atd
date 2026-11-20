import UIKit

/// The keyboard's sizes, at the density of the system keyboard: keys 42 pt tall with 6 pt between
/// them and 12 pt between rows, a 50 pt strip, and the ✦ line 42 pt more. With the line open the
/// keyboard is 308 pt, under the 320 pt the plan allows.
enum KeyboardMetrics {
  static let keyHeight: CGFloat = 42
  static let columnGap: CGFloat = 6
  static let rowGap: CGFloat = 12
  static let keysInsets = UIEdgeInsets(top: 8, left: 3, bottom: 4, right: 3)
  static let stripHeight: CGFloat = 50
  static let askHeight: CGFloat = 42
  static let keyCorner: CGFloat = 8.5
  /// The strip's buttons at either end.
  static let stripButton: CGFloat = 44

  static var keysHeight: CGFloat {
    keysInsets.top + 4 * keyHeight + 3 * rowGap + keysInsets.bottom
  }

  static func height(asking: Bool) -> CGFloat {
    stripHeight + keysHeight + (asking ? askHeight : 0)
  }
}

/// Key colors in the system keyboard's light and dark looks.
enum KeyboardColors {
  static let letterKey = UIColor { traits in
    traits.userInterfaceStyle == .dark ? UIColor(white: 0.42, alpha: 1) : .white
  }
  static let functionKey = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(white: 0.27, alpha: 1) : UIColor(red: 0.68, green: 0.7, blue: 0.74, alpha: 1)
  }
  /// The strip's chips: a lighter version of the key color, so they read as buttons on the strip.
  static let chip = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(white: 1, alpha: 0.14) : UIColor(white: 1, alpha: 0.7)
  }
  static let selectedChip = UIColor { traits in
    traits.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.32) : .white
  }
}

/// The keyboard's copy, from this module's String Catalog.
enum KeyboardText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }

  /// The return key's label for the host field's return key type.
  static func returnTitle(_ type: UIReturnKeyType) -> String {
    switch type {
    case .go: string("return.go")
    case .google, .search, .yahoo: string("return.search")
    case .join: string("return.join")
    case .next: string("return.next")
    case .route: string("return.route")
    case .send: string("return.send")
    case .done: string("return.done")
    case .emergencyCall: string("return.call")
    case .continue: string("return.continue")
    default: string("return.default")
    }
  }
}
