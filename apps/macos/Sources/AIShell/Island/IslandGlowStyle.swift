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
