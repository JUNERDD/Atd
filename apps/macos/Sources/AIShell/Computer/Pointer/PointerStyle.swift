import AICore
import AppKit
import QuartzCore

/// The live pointer's shapes, type and motion. No state is told by colour alone: every phase has
/// a label, and the ring's shape changes with it (dashed while the host looks or waits, solid
/// while it acts or confirms), with a click ripple, an input field bar, or a scroll direction bar.
/// Motion only explains a change: a mark fades in where it appears, glides on a spring with no
/// bounce between nearby targets, and fades out after a confirmed step; under Reduce Motion the
/// glide and the ripple's growth become short fades, never nothing.
enum PointerStyle {
  /// The arrow's body below and right of its tip.
  static let arrowSize = CGSize(width: 13, height: 20)
  /// Room between the target and its ring.
  static let ringOutset: CGFloat = 3
  static let ringRadius: CGFloat = 6
  static let ringDash: [NSNumber] = [5, 3]
  static let rippleRadius: CGFloat = 14
  static let rippleDuration: CFTimeInterval = 0.5
  /// A glide between two targets: a short hint of where the mark went, never a travel path. A
  /// critically damped spring (no overshoot), so the mark settles on the target rather than past
  /// it.
  static let glideResponse: CFTimeInterval = 0.25
  /// A mark appearing, or moving without a glide.
  static let fadeInDuration: CFTimeInterval = 0.15
  static let fadeDuration: CFTimeInterval = 0.2

  /// The glide's spring for `keyPath`, from `from` to `to`.
  static func glide(_ keyPath: String, from: Any?, to: Any?) -> CASpringAnimation {
    let spring = CASpringAnimation(perceptualDuration: glideResponse, bounce: 0)
    spring.keyPath = keyPath
    spring.fromValue = from
    spring.toValue = to
    spring.duration = spring.settlingDuration
    return spring
  }

  static let labelHeight: CGFloat = 20
  static let labelPadding: CGFloat = 6
  static let labelGap: CGFloat = 4
  static let markSide: CGFloat = 12
  static let labelFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
  static let badgeFont = NSFont.monospacedSystemFont(ofSize: 10, weight: .bold)

  /// The label's catalog key; nil for a phase that never draws (a failed step is removed).
  static func label(_ phase: PointerPhase, action: PointerAction) -> ShellStringKey? {
    switch phase {
    case .locating: .pointerLocating
    case .dispatching:
      switch action {
      case .click: .pointerClicking
      case .scroll(.up): .pointerScrollUp
      case .scroll(.down): .pointerScrollDown
      case .scroll(.left): .pointerScrollLeft
      case .scroll(.right): .pointerScrollRight
      default: .pointerActing
      }
    case .typingField:
      switch action {
      case .type: .pointerTyping
      case .clear: .pointerClearing
      default: .pointerFilling
      }
    case .waiting: .pointerWaiting
    case .verifying: .pointerVerifying
    case .done: .pointerDone
    case .failed: nil
    }
  }

  /// A short bar on the edge indicated by the scroll direction. It marks the operation's
  /// direction, not a progress percentage or an invented mouse trajectory.
  static func scrollBar(for action: PointerAction, in target: CGRect) -> CGRect? {
    guard case .scroll(let direction) = action, target.width >= 12, target.height >= 12 else {
      return nil
    }
    let horizontal = min(28, target.width - 8)
    let vertical = min(28, target.height - 8)
    switch direction {
    case .up:
      return CGRect(
        x: target.midX - horizontal / 2, y: target.minY + 2, width: horizontal, height: 3)
    case .down:
      return CGRect(
        x: target.midX - horizontal / 2, y: target.maxY - 5, width: horizontal, height: 3)
    case .left:
      return CGRect(x: target.minX + 2, y: target.midY - vertical / 2, width: 3, height: vertical)
    case .right:
      return CGRect(x: target.maxX - 5, y: target.midY - vertical / 2, width: 3, height: vertical)
    }
  }

  /// Dashed while the host is looking or waiting; solid while it acts or confirms.
  static func isDashed(_ phase: PointerPhase) -> Bool {
    switch phase {
    case .locating, .waiting, .verifying: true
    case .dispatching, .typingField, .done, .failed: false
    }
  }

  /// A classic arrow with its tip at the origin and its body below and right of it, in layer
  /// space (y up): the shape reads as a pointer, the coral and the Atd mark beside it as Atd's.
  static let arrowPath: CGPath = {
    let path = CGMutablePath()
    path.move(to: .zero)
    path.addLines(between: [
      .zero, CGPoint(x: 0, y: -17), CGPoint(x: 4.2, y: -13.2), CGPoint(x: 7.2, y: -19.8),
      CGPoint(x: 9.8, y: -18.6), CGPoint(x: 6.9, y: -12.2), CGPoint(x: 12.2, y: -12.2),
    ])
    path.closeSubpath()
    return path
  }()

  /// The menu bar's template mark, the Atd sign the label starts with; nil outside the app
  /// bundle (tests, `swift run`), where the label goes without it.
  static let mark: NSImage? = NSImage(named: "idleTemplate")

  /// One line of label text, its width measured for the pill.
  static func text(_ string: String, font: NSFont, color: CGColor) -> NSAttributedString {
    NSAttributedString(
      string: string,
      attributes: [.font: font, .foregroundColor: NSColor(cgColor: color) ?? .white])
  }
}

/// The pointer's colours: the release film's coral, the values of the typing trace's private
/// `Coral` (``InsertionTraceOverlay``), so both of Atd's marks over other apps look the same.
/// Kept in step by hand while that palette stays private to its file.
enum PointerPalette {
  static let coral = color(255, 106, 61)
  static let deep = color(226, 71, 28)
  static let glow = color(255, 106, 61, 0.55)
  /// The light edge under the ring and field bar in the default look, so they keep 3:1 over
  /// mid-tone and dark content as well as over white (where the deep coral alone measures 4.1:1).
  static let halo = color(255, 255, 255, 0.85)
  /// The ring's fill, a faint wash over the target that leaves it readable.
  static let fill = color(255, 106, 61, 0.1)
  static let fillStrong = color(255, 106, 61, 0.18)
  static let labelFill = color(226, 71, 28, 0.96)
  static let white = color(255, 255, 255)
  static let badgeFill = color(255, 255, 255, 0.92)
  /// The dark edge Increase Contrast adds around the ring and label.
  static let ink = color(20, 20, 20, 0.92)
  static let shadow = color(0, 0, 0, 0.35)

  private static func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1)
    -> CGColor
  {
    CGColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
  }
}
