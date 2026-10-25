/// The command island's fixed light field and transition values.
enum IslandGlowStyle {
  /// Crop a larger field so its edges never become the HUD's edges.
  static let fieldScale = 2.2
  /// An already visible HUD fades in its light; a fresh HUD starts with it already present.
  static let entryDuration = 0.40
  static let exitDuration = 0.85
  static let reducedMotionDuration = 0.20
  static let writingHue = -28.0
  static let hueDuration = 0.45
}

/// The field's colors: the working light, or the attention light a task waiting for the person
/// (a human-in-the-loop request) turns it to. Both appearances share one field and interpolation.
enum IslandGlowPalette: CaseIterable, Sendable {
  case working
  case attention

  /// How much stronger than the working light the field draws: warm tones over the dark glass
  /// read as brown at the working light's strength.
  func emphasis(dark: Bool) -> Double {
    switch self {
    case .working: 1
    case .attention: dark ? 1.6 : 1.4
    }
  }

  /// The deep, middle and highlight tones the field interpolates, as linear RGB.
  func tones(dark: Bool) -> (deep: SIMD3<Double>, steel: SIMD3<Double>, mist: SIMD3<Double>) {
    switch (self, dark) {
    case (.working, false): (SIMD3(0.06, 0.86, 0.70), SIMD3(0.08, 0.64, 1.0), SIMD3(0.96, 1.0, 1.0))
    case (.working, true):
      (SIMD3(0.035, 0.11, 0.17), SIMD3(0.28, 0.51, 0.68), SIMD3(0.68, 0.79, 0.88))
    case (.attention, false): (SIMD3(1.0, 0.5, 0.02), SIMD3(1.0, 0.7, 0.2), SIMD3(1.0, 0.97, 0.9))
    case (.attention, true):
      (SIMD3(0.36, 0.15, 0.02), SIMD3(1.0, 0.58, 0.16), SIMD3(1.0, 0.88, 0.64))
    }
  }
}
