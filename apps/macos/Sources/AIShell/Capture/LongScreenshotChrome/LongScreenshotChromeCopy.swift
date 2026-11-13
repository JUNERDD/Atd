import AICore
import AppKit

/// The long screenshot chrome's copy, in the shell language: the bar's labels, the status row's
/// messages and the strip's caption, and how they write the screens and points they count.
enum LongScreenshotChromeCopy {
  /// One status row message: its glyph, its text, and whether the glyph takes the attention
  /// colour (something went wrong or is missing).
  struct Message: Equatable {
    let glyph: String
    let text: String
    let attention: Bool
  }

  /// Every message the row can show, which the block reserves the widest of; the end's with the
  /// toggle for the part below the selection, in both of its states.
  static let messages: [LongScreenshotMessage] = [
    .start, .lost, .end(tail: .none), .end(tail: .excluded), .end(tail: .included),
    .needsPermission, .limit,
  ]

  /// The widest count the control bar reserves room for (``captured(_:)``).
  static let widestScreens = 88.8

  static func text(_ key: LongScreenshotChromeStringKey) -> String {
    ShellStrings.shared.text(key)
  }

  /// "Name (key)", the capture tooltips' form.
  static func tooltip(_ name: String, key: String) -> String {
    String(format: ShellStrings.shared.text(.captureTooltipShortcut), name, key)
  }

  /// Screens as the prototype writes them (`longshot.js`, `screensText`): one decimal below ten
  /// (`2.4`), whole numbers from there (`12`), so the reserved "88.8" stays the widest up to
  /// 999 with tabular digits.
  static func screens(_ value: Double) -> String {
    value < 9.95 ? String(format: "%.1f", max(0, value)) : String(Int(value.rounded()))
  }

  /// The control bar's count: "Captured 2.4 screens".
  static func captured(_ screens: Double) -> String {
    ShellStrings.shared.text(LongScreenshotChromeStringKey.captured, Self.screens(screens))
  }

  /// The strip's caption: "2.4 screens · 1,234 pt", or that stitching waits while it is lost.
  static func caption(_ progress: LongScreenshotProgress) -> String {
    guard progress.lost == nil else { return text(.stripLost) }
    let points = Int(progress.height.rounded()).formatted(
      .number.locale(Locale(identifier: "en_US")))
    return String(
      format: text(.stripCaption),
      locale: Locale(identifier: ShellStrings.shared.language.rawValue),
      screens(progress.screens), points)
  }

  static func message(_ message: LongScreenshotMessage) -> Message {
    switch message {
    case .start:
      Message(glyph: LongScreenshotChromeIcons.scroll, text: text(.messageStart), attention: false)
    case .lost:
      Message(glyph: LongScreenshotChromeIcons.alert, text: text(.messageLost), attention: true)
    case .end:
      Message(glyph: LongScreenshotChromeIcons.end, text: text(.messageEnd), attention: false)
    case .needsPermission:
      Message(
        glyph: LongScreenshotChromeIcons.alert, text: text(.messageNeedsPermission),
        attention: true)
    case .limit:
      Message(glyph: LongScreenshotChromeIcons.end, text: text(.messageLimit), attention: false)
    }
  }

  /// The colour of a glyph or caption that needs attention, as the mosaic tool's dot shows
  /// unmasked sensitive text (``AnnotationToolBadge``).
  static let attention = NSColor.systemOrange
}

/// The chrome's Lucide glyphs, template image sets in the App target's asset catalog, found by
/// ``AnnotationIcons/glyph(_:label:)``. Source: `mouse` and `panel-bottom` carry the paths of the
/// installed `lucide-react` 1.61.0 (ISC), the version pinned in `pnpm-workspace.yaml`
/// (`dist/esm/icons/<name>.mjs`), in `App/Assets.xcassets/Capture`; `play` and `pause` are the
/// selection toolbar's sets, `triangle-alert` the Island's, `x` and `check` the annotation
/// toolbar's (``AnnotationIcons``).
enum LongScreenshotChromeIcons {
  static let autoScroll = "play"
  static let pause = "pause"
  static let scroll = "mouse"
  static let alert = "triangle-alert"
  static let end = AnnotationIcons.confirm
  /// The status row's toggle for the scroll area's part below the selection.
  static let tail = "panel-bottom"
  static let back = AnnotationIcons.cancel
  static let done = AnnotationIcons.confirm
}
