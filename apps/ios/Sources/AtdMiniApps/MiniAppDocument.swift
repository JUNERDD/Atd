import AtdInk
import AtdModel
import Foundation
import UIKit

/// The HTML document a mini app's page runs in, which Atd assembles around the page the model
/// wrote: the security policy, the ink kit's styles with colors resolved from the system's, the
/// data the page starts from and `window.atd`, then the page.
public enum MiniAppDocument {
  /// Every mini app document's policy: inline script and style only, images and fonts only from
  /// data URLs, no network of any kind, no frames, no workers, no form that goes anywhere.
  /// `sandbox` gives the document an opaque origin, so it has no cookies or storage either: data
  /// lives only where Atd keeps it, which is also where the widget reads it.
  public static let contentSecurityPolicy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
    + "font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; "
    + "object-src 'none'; form-action 'none'; base-uri 'none'; "
    + "sandbox allow-scripts allow-forms allow-modals"

  /// The same policy for the document's `<meta>`, which cannot carry `sandbox`: the response
  /// header has it, and the meta tag keeps the rest if a document is ever loaded without one.
  static var metaPolicy: String {
    contentSecurityPolicy.components(separatedBy: "; ").filter { !$0.hasPrefix("sandbox") }
      .joined(separator: "; ")
  }

  /// - Parameters:
  ///   - snapshot: what the page starts from (`MiniAppSnapshot.json`).
  public static func html(
    page: String, tint: CommandTint, snapshot: MiniAppJSON, locale: Locale = .current
  ) -> String {
    let boot = MiniAppJSON.object([
      "snapshot": snapshot, "locale": .string(locale.identifier(.bcp47)),
    ])
    return """
      <!doctype html>
      <html lang="\(locale.identifier(.bcp47))">
      <head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="\(metaPolicy)">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, \
      viewport-fit=cover">
      <style>
      \(tokens(tint: tint))
      \(resource("MiniAppKit", "css"))
      </style>
      <script id="atd-boot" type="application/json">\(scriptSafe(boot.jsonString))</script>
      <script>
      \(resource("MiniAppRuntime", "js"))
      </script>
      </head>
      <body>
      <svg class="ink-defs" aria-hidden="true"><filter id="ink-rough" x="-4%" y="-4%" \
      width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.035" \
      numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter></svg>
      <main id="app">
      \(page)
      </main>
      </body>
      </html>
      """
  }

  /// JSON inside `<script>`: `<` escaped, so no value can close the element.
  static func scriptSafe(_ json: String) -> String {
    json.replacingOccurrences(of: "<", with: "\\u003c")
  }

  /// The kit's colors, resolved from the system colors in light and dark the way AtdInk mixes
  /// them, so a page's paper, ink, highlighters and illustrations match the app's.
  static func tokens(tint: CommandTint) -> String {
    func values(_ style: UIUserInterfaceStyle) -> String {
      let traits = UITraitCollection(userInterfaceStyle: style)
      let dark = style == .dark
      func css(_ color: UIColor) -> String { cssColor(color.resolvedColor(with: traits)) }
      func highlighter(_ hue: UIColor, light: CGFloat, dark darkShare: CGFloat) -> String {
        let resolved = hue.resolvedColor(with: traits)
        return cssColor(
          dark ? mix(resolved, .black, darkShare) : mix(resolved, .white, light))
      }
      let label = UIColor.label.resolvedColor(with: traits)
      var lines = [
        "--paper: \(css(InkColor.paperUIColor))", "--shade: \(css(InkColor.shadeUIColor))",
        "--deep: \(css(InkColor.deepUIColor))",
        "--ink: \(css(.label))", "--ink-solid: \(css(.label))", "--ink-2: \(css(.secondaryLabel))",
        "--ink-3: \(css(.tertiaryLabel))", "--line: \(cssColor(label.withAlphaComponent(0.52)))",
        "--card-line: \(cssColor(label.withAlphaComponent(0.24)))",
        "--hl: \(highlighter(tint.uiColor, light: 0.42, dark: 0.5))",
        "--on: \(highlighter(.systemGreen, light: 0.46, dark: 0.52))",
        "--chosen: \(highlighter(.systemYellow, light: 0.42, dark: 0.34))",
      ]
      for other in CommandTint.allCases {
        lines.append(
          "--hl-\(other.rawValue): \(highlighter(other.uiColor, light: 0.42, dark: 0.5))")
      }
      return lines.joined(separator: "; ")
    }
    return ":root { \(values(.light)); }\n"
      + "@media (prefers-color-scheme: dark) { :root { \(values(.dark)); } }"
  }

  private static func cssColor(_ color: UIColor) -> String {
    var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    func channel(_ value: CGFloat) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
    let rgb = "\(channel(red)) \(channel(green)) \(channel(blue))"
    return alpha >= 1 ? "rgb(\(rgb))" : "rgb(\(rgb) / \(String(format: "%.2f", alpha)))"
  }

  /// `share` of `color` and the rest of `base`, as AtdInk's highlighters are mixed.
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

  private static let resources = ResourceCache()

  static func resource(_ name: String, _ type: String) -> String {
    resources.text(name, type)
  }
}

/// The kit's files, read from this module's bundle once.
private final class ResourceCache: Sendable {
  private let texts: [String: String]

  init() {
    var texts: [String: String] = [:]
    for (name, type) in [("MiniAppKit", "css"), ("MiniAppRuntime", "js")] {
      guard let url = Bundle.module.url(forResource: name, withExtension: type),
        let text = try? String(contentsOf: url, encoding: .utf8)
      else {
        // The kit ships in this module's bundle; without it the build itself is broken.
        fatalError("\(name).\(type) is missing from the app")
      }
      texts["\(name).\(type)"] = text
    }
    self.texts = texts
  }

  func text(_ name: String, _ type: String) -> String {
    texts["\(name).\(type)"] ?? ""
  }
}
