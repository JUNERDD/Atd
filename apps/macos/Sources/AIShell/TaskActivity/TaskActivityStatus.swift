import AICore
import SwiftUI

/// Lifecycle motion. Labels, details and actions replace directly, since an outgoing label
/// fading over its successor read as a flash; glyphs swap, artwork settles, and a card moving to
/// another section springs there, without bounce.
enum TaskActivityMotion {
  /// Artwork settles on one curve without bounce.
  static func settle(reduced: Bool) -> Animation {
    reduced ? .easeInOut(duration: 0.2) : .smooth(duration: 0.35)
  }

  /// Layout changes on a lifecycle change. Reduce Motion keeps rows in place: they jump, and
  /// the glyphs' fades still mark what changed.
  static func layout(reduced: Bool) -> Animation? {
    reduced ? nil : .snappy(duration: 0.32, extraBounce: -0.15)
  }

  /// A stack of requests spreads out and folds back on one spring with no bounce: a tap, not a
  /// fling. Reduce Motion cross-fades instead.
  static func stack(reduced: Bool) -> Animation {
    reduced ? .easeOut(duration: 0.2) : .spring(stackSpring)
  }

  /// The open card's glass follows a change of its height on the requests' spring.
  static let resize = Animation.spring(stackSpring)

  private static let stackSpring = Spring(duration: 0.38, bounce: 0)

  /// A later request unfolds from under the first, each a moment after the one before, and
  /// folds back the same way, quicker; Reduce Motion fades it.
  static func unfold(order: Int, reduced: Bool) -> AnyTransition {
    guard !reduced else { return .opacity.animation(stack(reduced: true)) }
    let shape = AnyTransition.offset(y: -12 * Double(order)).combined(
      with: .scale(scale: 0.94, anchor: .top))
    let arrive = Animation.spring(stackSpring).delay(Double(min(order - 1, 3)) * 0.03)
    let leave = Animation.spring(Spring(duration: 0.3, bounce: 0)).delay(Double(order - 1) * 0.02)
    return .asymmetric(
      insertion: shape.combined(with: .opacity).animation(arrive),
      removal: shape.combined(with: .opacity.animation(.easeIn(duration: 0.1))).animation(leave))
  }

  /// A request's page and the list replace each other on the card's smooth curve.
  static let page = Animation.smooth(duration: 0.22)

  /// A request's page slides in 12 pt as it fades in; Reduce Motion keeps only the fade.
  static func pageTransition(reduced: Bool) -> AnyTransition {
    reduced
      ? .opacity
      : .asymmetric(insertion: .offset(x: 12).combined(with: .opacity), removal: .opacity)
  }

  /// A glyph swap as a symbol's replace: the old one leaves quickly, the new one grows in just
  /// after it, so the two never overlap at half strength. Reduce Motion keeps only the fades.
  static func replace(reduced: Bool) -> AnyTransition {
    let leave = Animation.easeIn(duration: 0.08)
    let arrive =
      reduced ? Animation.easeOut(duration: 0.16).delay(0.06) : .snappy(duration: 0.3).delay(0.06)
    let shape: AnyTransition = reduced ? .opacity : .scale(scale: 0.4).combined(with: .opacity)
    return .asymmetric(insertion: shape.animation(arrive), removal: shape.animation(leave))
  }
}

/// A glyph that swaps with ``TaskActivityMotion/replace(reduced:)``. Each new `callout`
/// scales it up and back once to draw the eye; never under Reduce Motion.
struct TaskActivityGlyphSwap<Glyph: View>: View {
  let identity: String
  let callout: String?
  let side: Double
  let reducedMotion: Bool
  @ViewBuilder let glyph: () -> Glyph
  @State private var pulse = 0

  var body: some View {
    ZStack {
      glyph()
        .id(identity)
        .transition(TaskActivityMotion.replace(reduced: reducedMotion))
    }
    .frame(width: side, height: side)
    .keyframeAnimator(initialValue: 1.0, trigger: pulse) { content, scale in
      content.scaleEffect(scale)
    } keyframes: { _ in
      CubicKeyframe(1.0, duration: 0.1)
      SpringKeyframe(1.25, duration: 0.16, spring: .snappy)
      SpringKeyframe(1.0, duration: 0.34, spring: .smooth)
    }
    .onChange(of: callout) { _, next in
      if next != nil && !reducedMotion { pulse += 1 }
    }
    .accessibilityHidden(true)
  }
}
