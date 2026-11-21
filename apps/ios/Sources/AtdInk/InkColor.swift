import AtdModel
import SwiftUI
import UIKit

/// The colors of Atd's ink-and-paper pages, in light and dark.
///
/// Paper is white in light and a soft charcoal in dark. Ink is the label color. A tint is used as
/// a highlighter on the paper (a pastel in light, a deep wash in dark): the 开 of a switch, the
/// chosen option, and a command's sticker, which is how a command is told apart. Color identifies;
/// it never decorates.
///
/// Nonisolated: UIKit may resolve a dynamic color on any thread, so the providers must not be
/// tied to the main actor.
public nonisolated enum InkColor {
  /// The paper, and an illustration's soft shade and deep fill, as UIKit colors, for what draws
  /// outside SwiftUI: a mini app's page gets them as its kit's `--paper`, `--shade` and `--deep`.
  public static let paperUIColor = dynamic(light: .white, dark: UIColor(white: 0.11, alpha: 1))
  public static let shadeUIColor = dynamic(
    light: UIColor(red: 0.945, green: 0.941, blue: 0.929, alpha: 1),
    dark: UIColor(red: 0.173, green: 0.173, blue: 0.18, alpha: 1))
  public static let deepUIColor = dynamic(
    light: UIColor(red: 0.871, green: 0.863, blue: 0.843, alpha: 1),
    dark: UIColor(red: 0.282, green: 0.282, blue: 0.29, alpha: 1))

  public static let paper = Color(uiColor: paperUIColor)
  /// The edge of controls drawn by hand.
  public static let line = Color(uiColor: .label).opacity(0.52)
  /// The edge of a card, lighter than a control's.
  public static let cardLine = Color(uiColor: .label).opacity(0.24)
  /// A pressed control's fill.
  public static let press = Color(uiColor: .label).opacity(0.07)
  /// The soft shade under an illustration.
  public static let shade = Color(uiColor: shadeUIColor)
  /// The deep fill of an illustration.
  public static let deep = Color(uiColor: deepUIColor)
  /// A switch that is on: green highlighter.
  public static let on = highlighter(.systemGreen, light: 0.46, dark: 0.52)
  /// The chosen option of a segmented choice: yellow highlighter.
  public static let chosen = highlighter(.systemYellow, light: 0.42, dark: 0.34)
  /// Something that needs attention, such as a key a provider refused.
  public static let alert = Color(uiColor: .systemRed)

  /// A command's sticker: its hue as a highlighter blob.
  public static func sticker(_ tint: CommandTint) -> Color {
    highlighter(tint.uiColor, light: 0.26, dark: 0.36)
  }

  /// The glyph inked on a sticker: the label color with a little of the hue.
  public static func stickerGlyph(_ tint: CommandTint) -> Color {
    Color(
      uiColor: UIColor { traits in
        let hue = tint.uiColor.resolvedColor(with: traits)
        return traits.userInterfaceStyle == .dark
          ? mix(hue, .white, 0.22) : mix(hue, UIColor(white: 0.11, alpha: 1), 0.34)
      })
  }

  /// `color` laid on the paper: mixed with white in light and with black in dark.
  public static func highlighter(_ color: UIColor, light: CGFloat, dark: CGFloat) -> Color {
    Color(
      uiColor: UIColor { traits in
        let hue = color.resolvedColor(with: traits)
        return traits.userInterfaceStyle == .dark
          ? mix(hue, .black, dark) : mix(hue, .white, light)
      })
  }

  private static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
    UIColor { $0.userInterfaceStyle == .dark ? dark : light }
  }

  /// `share` of `color` and the rest of `base`.
  private static func mix(_ color: UIColor, _ base: UIColor, _ share: CGFloat) -> UIColor {
    var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    color.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
    base.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
    let rest = 1 - share
    return UIColor(
      red: r1 * share + r2 * rest, green: g1 * share + g2 * rest, blue: b1 * share + b2 * rest,
      alpha: 1)
  }
}

extension CommandTint {
  /// The system hue this tint names.
  public nonisolated var uiColor: UIColor {
    switch self {
    case .red: .systemRed
    case .orange: .systemOrange
    case .yellow: .systemYellow
    case .green: .systemGreen
    case .mint: .systemMint
    case .teal: .systemTeal
    case .cyan: .systemCyan
    case .blue: .systemBlue
    case .indigo: .systemIndigo
    case .purple: .systemPurple
    case .pink: .systemPink
    case .brown: .systemBrown
    case .gray: .systemGray
    }
  }
}
