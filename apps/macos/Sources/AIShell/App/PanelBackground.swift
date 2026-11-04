import AICore
import Foundation
import Observation

/// The user's Panel background setting in the shell: the fill the shell's own glass carries in
/// each scheme, how much the floating surfaces' washes strengthen over it, the Liquid Glass variant
/// and its blur and refraction relative to the system's. The renderer is its one derivation
/// owner: the panel page pushes the resolved values (`panelBackground.set`) after settings load and
/// on every change, and the shell only applies them. The last push is kept in the user defaults,
/// so a launch shows it before that first push; until the first push ever, the shell takes the
/// measured recipe (``measured``), which is also the setting's default.
///
/// SwiftUI glass reads it through observation; AppKit glass and the glass tuner are told on every
/// change (``GlassSurface/backgroundDidChange()``).
@Observable
final class PanelBackground {
  static let shared = PanelBackground()

  /// One scheme's fill and the factor on the floating surfaces' washes over it.
  struct Tone: Equatable {
    let red: Int
    let green: Int
    let blue: Int
    /// The fill's opacity over Liquid Glass, 0–1 (1 is the Solid setting).
    let alpha: Double
    /// The factor, 1–4, on the floating surfaces' vibrant washes (``IslandWash``,
    /// ``MiniPanelWash``): a thinner fill lets more of the backdrop through, which a wash in the
    /// label color has to outweigh to stay visible. 1 over a fill of 80% or more.
    let washScale: Double
  }

  /// The setting the shell applies now: the last push, or the measured recipe before any.
  private(set) var setting: PanelBackgroundSetPost

  @ObservationIgnored private let defaults: UserDefaults

  /// The defaults key of the last pushed setting, as its JSON; absent until the first push.
  private static let key = "panelBackground"

  /// The measured recipe the setting defaults to (`DEFAULT_PANEL_BACKGROUND`, derived in the
  /// renderer's `apps/desktop/src/theme/panel-background/`): a dark fill of rgb(24 24 24 / 60%)
  /// and a light one of rgb(255 255 255 / 56%), regular glass at the system's blur and refraction.
  static let measured = PanelBackgroundSetPost(
    dark: .init(red: 24, green: 24, blue: 24, alpha: 0.6, washScale: 2),
    light: .init(red: 255, green: 255, blue: 255, alpha: 0.56, washScale: 2.3),
    glass: .regular, blur: 1, refractionWidth: 1, refractionStrength: 1)

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    // A stored setting the current contract no longer decodes is dropped for the default.
    setting =
      defaults.data(forKey: Self.key).flatMap {
        try? JSONDecoder().decode(PanelBackgroundSetPost.self, from: $0)
      } ?? Self.measured
  }

  /// Hands the stored setting to the glass tuner. Call it once at launch, before the first window
  /// is made; the fill and the variant need nothing more, since the glass reads them as it is made.
  func restore() {
    GlassTuner.shared.apply(tuning)
  }

  /// Applies and keeps `setting`, the page's resolved push.
  func apply(_ setting: PanelBackgroundSetPost) {
    if let data = try? JSONEncoder().encode(setting) { defaults.set(data, forKey: Self.key) }
    guard setting != self.setting else { return }
    self.setting = setting
    GlassSurface.backgroundDidChange()
  }

  /// The fill and wash factor of the dark or the light scheme.
  func tone(dark: Bool) -> Tone {
    if dark {
      let tone = setting.dark
      return Tone(
        red: tone.red, green: tone.green, blue: tone.blue, alpha: tone.alpha,
        washScale: tone.washScale)
    }
    let tone = setting.light
    return Tone(
      red: tone.red, green: tone.green, blue: tone.blue, alpha: tone.alpha,
      washScale: tone.washScale)
  }

  /// Whether the glass takes Liquid Glass's clear variant rather than the regular one.
  var clearGlass: Bool { setting.glass == .clear }

  /// The factors on the system's blur and refraction (``GlassTuner``).
  var tuning: GlassTuner.Factors {
    GlassTuner.Factors(
      blur: setting.blur, refractionWidth: setting.refractionWidth,
      refractionStrength: setting.refractionStrength)
  }

  /// `level`, a floating surface's wash in the label color, strengthened for the fill under it in
  /// the surfaces' scheme (``GlassSurface/isDark``) and capped at full. Under Reduce Transparency
  /// the fill is opaque, so the wash keeps its own level.
  func wash(_ level: Double, reduceTransparency: Bool) -> Double {
    guard !reduceTransparency else { return level }
    return min(level * tone(dark: GlassSurface.isDark).washScale, 1)
  }
}
