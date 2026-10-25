import SwiftUI

/// The working light and the attention light, mounted together: a change of palette cross-fades
/// between them, so the light never goes out in between. The caller fades the whole glow in and
/// out; while it fades out (`palette` nil), the last palette stays.
struct IslandPaletteGlow: View {
  let palette: IslandGlowPalette?
  var motionEnabled = true
  @State private var shown: IslandGlowPalette

  init(palette: IslandGlowPalette?, motionEnabled: Bool = true) {
    self.palette = palette
    self.motionEnabled = motionEnabled
    _shown = State(initialValue: palette ?? .working)
  }

  var body: some View {
    ZStack {
      ForEach(IslandGlowPalette.allCases, id: \.self) { candidate in
        IslandWorkingGlow(
          active: palette != nil && shown == candidate, motionEnabled: motionEnabled,
          palette: candidate
        )
        .opacity(shown == candidate ? 1 : 0)
      }
    }
    .animation(
      .easeInOut(
        duration: motionEnabled
          ? IslandGlowStyle.hueDuration : IslandGlowStyle.reducedMotionDuration),
      value: shown
    )
    .onChange(of: palette) { _, next in
      if let next { shown = next }
    }
  }
}
