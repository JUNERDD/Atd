import Observation
import QuartzCore
import SwiftUI

/// Only the nested background host observes this state. Clock samples never publish mutations.
@Observable final class IslandGlowFieldState {
  private(set) var active: Bool
  private(set) var strength = 0.0
  private(set) var running = false
  @ObservationIgnored private var accumulatedPhase = 0.0
  @ObservationIgnored private var anchor = CACurrentMediaTime()

  init(active: Bool) {
    self.active = active
  }

  func update(active: Bool, strength: Double, running: Bool) {
    if self.running != running {
      let now = CACurrentMediaTime()
      accumulatedPhase = phase(at: now)
      anchor = now
    }
    self.active = active
    self.strength = strength
    self.running = running
  }

  func pause() {
    update(active: active, strength: strength, running: false)
  }

  /// Pause and resume at the same phase so window visibility never jumps the light.
  func phase(at now: CFTimeInterval) -> Double {
    accumulatedPhase + (running ? now - anchor : 0)
  }
}

/// One opaque mesh with a uniform overall opacity, so no transparent tails meet in the middle.
/// The fixed outer ring covers the capsule while its internal shapes and color regions flow.
struct IslandGlowField: View {
  let state: IslandGlowFieldState
  let palette: IslandGlowPalette
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    GeometryReader { geometry in
      TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !state.running)) { _ in
        let phase = state.phase(at: CACurrentMediaTime())
        let size = geometry.size
        let scale = IslandGlowStyle.fieldScale
        let drift = (scale - 1) * 0.12
        // Only a crop of the larger field is visible; its edges never become the HUD's edges.
        MeshGradient(
          width: 6, height: 4,
          points: points(phase: phase),
          colors: colors(phase: phase),
          smoothsColors: true
        )
        .frame(width: size.width * scale, height: size.height * scale)
        .position(
          x: size.width / 2 + size.width * drift * sin(phase * 0.39),
          y: size.height / 2 + size.height * drift * cos(phase * 0.31 + 1.2)
        )
        .opacity(state.strength)
      }
    }
    .clipped()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func points(phase: Double) -> [SIMD2<Float>] {
    return (0..<4).flatMap { row in
      (0..<6).map { column in
        let x = Double(column) / 5
        let y = Double(row) / 3
        let interior = (1...2).contains(row) && (1...4).contains(column)
        let envelope = interior ? sin(.pi * x) * sin(.pi * y) : 0
        // Neighboring points follow a shared smooth field to avoid folds at high deformation.
        let dx =
          0.03 * envelope
          * (0.7 * sin(0.88 * phase + 2.2 * y) + 0.3 * sin(0.53 * phase + 2.6 * x + 0.4))
        let dy =
          0.06 * envelope
          * (0.7 * cos(0.74 * phase + 2.4 * x) + 0.3 * sin(1.07 * phase + 1.8 * y))
        return SIMD2(Float(x + dx), Float(y + dy))
      }
    }
  }

  private func colors(phase: Double) -> [Color] {
    let theta = 0.35 + (2.4 * sin(0.66 * phase) + 0.6 * sin(0.37 * phase + 0.8))
    let phi = 0.25 + 0.55 * sin(0.61 * phase + 1.6)
    // Unit-length weights keep the field alive; unrelated 2D bases cannot become a single sweep.
    let weights = SIMD3(cos(theta) * cos(phi), sin(theta) * cos(phi), sin(phi))
    let values = Self.colorBases.map { basis in
      0.65 * (basis.x * weights.x + basis.y * weights.y + basis.z * weights.z)
    }
    let softness = 0.5 / 1.5 * 0.32
    let softened = values.indices.map { index in
      let row = index / 6
      let column = index % 6
      var neighborhood = values[index]
      var count = 1.0
      for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        let x = column + dx
        let y = row + dy
        if (0..<6).contains(x) && (0..<4).contains(y) {
          neighborhood += values[y * 6 + x]
          count += 1
        }
      }
      return values[index] + (neighborhood / count - values[index]) * softness
    }
    let mean = softened.reduce(0, +) / Double(softened.count)
    let (deep, steel, mist) = palette.tones(dark: colorScheme != .light)
    return softened.map { value in
      let tone = 0.5 + 0.47 * tanh(1.7 * (value - mean))
      let color =
        (1 - tone) * (1 - tone) * deep + 2 * tone * (1 - tone) * steel + tone * tone * mist
      return Color(red: color.x, green: color.y, blue: color.z)
    }
  }

  /// Sample on the rest grid so local mesh motion carries color instead of cancelling itself.
  private static let colorBases: [SIMD3<Double>] = {
    let samples = (0..<24).map { index in
      let x = Double(index % 6) / 5
      let y = Double(index / 6) / 3
      return SIMD3(
        cos(.pi * x) * cos(.pi * (y - 0.25)),
        cos(.pi * y) * cos(.pi * (x - 0.35)),
        0.6 * cos(2 * .pi * x) * sin(.pi * y)
          + 0.4 * sin(.pi * x) * cos(.pi * (y + 0.2)))
    }
    let mean = samples.reduce(SIMD3<Double>.zero, +) / Double(samples.count)
    let centered = samples.map { $0 - mean }
    let scale = (0..<3).map { channel in
      centered.reduce(0) { max($0, abs($1[channel])) }
    }
    return centered.map { SIMD3($0.x / scale[0], $0.y / scale[1], $0.z / scale[2]) }
  }()
}
