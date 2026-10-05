import Foundation

/// An app's accent color (`WidgetCatalogApp.accentColor`, `#RRGGBB`), which its widgets'
/// `accent` token takes. An app declares one value for both appearances, so it is adapted at
/// render time: on a dark widget a dark accent is lightened, on a light widget a light accent is
/// darkened, until it reaches 3:1 contrast with the widget background (WCAG's floor for graphics
/// and large text). An accent that already reads well, like the system blue, is left as it is.
public struct WidgetAccent: Equatable, Sendable {
  /// sRGB components, 0...1.
  public let red: Double
  public let green: Double
  public let blue: Double

  /// Nil unless `hex` is `#` and six hex digits (`AppAccentColorSchema`).
  public init?(hex: String) {
    let digits = hex.utf8.dropFirst()
    guard hex.utf8.first == UInt8(ascii: "#"), digits.count == 6,
      digits.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 | 0x20 >= 97 && $0 | 0x20 <= 102) }),
      let value = UInt32(String(hex.dropFirst()), radix: 16)
    else { return nil }
    red = Double((value >> 16) & 0xFF) / 255
    green = Double((value >> 8) & 0xFF) / 255
    blue = Double(value & 0xFF) / 255
  }

  private init(red: Double, green: Double, blue: Double) {
    self.red = red
    self.green = green
    self.blue = blue
  }

  /// Relative luminance of the widget background the accent is checked against: white in light
  /// appearance, the system's dark widget gray (#2C2C2E) in dark appearance.
  private static let lightBackground = 1.0
  private static let darkBackground = 0.0253
  private static let minimumContrast = 3.0

  /// The accent to draw in the given appearance: mixed toward white (dark) or black (light) in
  /// tenths until it contrasts enough with the background.
  public func adapted(dark: Bool) -> WidgetAccent {
    let background = dark ? Self.darkBackground : Self.lightBackground
    for step in 0...10 {
      let mix = Double(step) / 10
      let candidate =
        dark
        ? WidgetAccent(
          red: red + (1 - red) * mix, green: green + (1 - green) * mix,
          blue: blue + (1 - blue) * mix)
        : WidgetAccent(red: red * (1 - mix), green: green * (1 - mix), blue: blue * (1 - mix))
      if Self.contrast(candidate.luminance, background) >= Self.minimumContrast { return candidate }
    }
    return self
  }

  /// Whether black reads better than white on this color: WCAG contrast with black beats contrast
  /// with white above a relative luminance of about 0.18. Content drawn on a fill of the accent
  /// itself, such as a launcher tile's symbol, picks its color by this.
  public var prefersDarkContent: Bool { luminance > 0.179 }

  /// WCAG relative luminance of the sRGB color.
  var luminance: Double {
    func linear(_ value: Double) -> Double {
      value <= 0.040_45 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  private static func contrast(_ first: Double, _ second: Double) -> Double {
    (max(first, second) + 0.05) / (min(first, second) + 0.05)
  }
}

extension WidgetCatalogApp {
  /// The app's accent, or nil for the system accent.
  public var accent: WidgetAccent? { accentColor.flatMap(WidgetAccent.init(hex:)) }
}

extension WidgetLauncherApp {
  /// The app's accent, or nil for a neutral tile.
  public var accent: WidgetAccent? { accentColor.flatMap(WidgetAccent.init(hex:)) }
}
