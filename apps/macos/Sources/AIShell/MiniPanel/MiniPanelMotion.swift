import AICore
import AppKit
import SwiftUI

/// The mini panel's motion as SwiftUI runs it (perf-v1, motion-v3). The values are
/// ``MiniPanelChoreography``'s; SwiftUI interpolates every shape, factor and look, so nothing is
/// written while anything moves, and only the window's snap is stepped on the display link.
///
/// Every write is plain, in no transaction of its own: each value carries the animation it moves
/// on (nil for a jump), which the views apply as scoped animations. Writes made together share
/// one transaction, so SwiftUI updates once for them; a write in another transaction (such as
/// `withAnimation`) would make it update for the earlier ones at once, on the spot.
enum MiniPanelMotion {
  /// The shortest wait that lets a change made now be drawn before an animation starts from it.
  static let frame = 1.0 / 60

  /// How long `spring` takes to come to rest, as SwiftUI runs it.
  static func settling(_ spring: MiniPanelSpring) -> Double { spring.spring.settlingDuration }
}

extension MiniPanelSpring {
  var animation: Animation { .spring(duration: duration, bounce: bounce) }
  var spring: Spring { Spring(duration: duration, bounce: bounce) }
}

extension MiniPanelCurve {
  var animation: Animation {
    switch self {
    case .spring(let spring): spring.animation
    case .easeIn(let duration): .easeIn(duration: duration)
    case .easeOut(let duration): .easeOut(duration: duration)
    }
  }
}

extension MiniPanelShapeMotion {
  /// The body's shape moving as one value, each axis on its own spring.
  var animation: Animation { Animation(MiniPanelAxisAnimation(motion: self)) }
}

/// Runs a body shape's change (``MiniPanelGlassRect``) with its thickness (x, width and corner)
/// and its length (y, height) each on their own spring after their own delay
/// (``MiniPanelShapeMotion``). One animation over one vector, so the glass, its clip and the
/// content following it are interpolated together. A change made while one runs adds to it, as
/// SwiftUI combines animations that do not merge, which for springs is the same as retargeting
/// them with their velocity.
nonisolated struct MiniPanelAxisAnimation: CustomAnimation {
  let motion: MiniPanelShapeMotion

  func animate<V: VectorArithmetic>(
    value: V, time: TimeInterval, context: inout AnimationContext<V>
  ) -> V? {
    let thickness = Spring(duration: motion.thickness.duration, bounce: motion.thickness.bounce)
    let length = Spring(duration: motion.length.duration, bounce: motion.length.bounce)
    let settles = max(
      motion.thicknessDelay + thickness.settlingDuration,
      motion.lengthDelay + length.settlingDuration)
    guard time < settles else { return nil }
    let across = Self.progress(thickness, after: motion.thicknessDelay, at: time)
    let along = Self.progress(length, after: motion.lengthDelay, at: time)
    // Anything else in the same scope moves with the length.
    guard let shape = value as? MiniPanelGlassRect else { return value.scaled(by: along) }
    let moved = MiniPanelGlassRect(
      x: shape.x * across, y: shape.y * along, width: shape.width * across,
      height: shape.height * along, corner: shape.corner * across)
    return moved as? V
  }

  /// How far along a unit change `spring` is `time` seconds in, once `delay` has passed.
  private static func progress(_ spring: Spring, after delay: Double, at time: Double) -> Double {
    time <= delay ? 0 : spring.value(target: 1.0, time: time - delay)
  }
}

/// The mini panel's glyphs (spec v1, Material). Functional glyphs are Lucide template image sets
/// in the App target's asset catalog (`App/Assets.xcassets/MiniPanel/lucide-<name>.imageset`;
/// Ask reuses the selection toolbar's `Selection/lucide-sparkles`), found in the main bundle by
/// `NSImage(named:)` like ``AnnotationIcons``'s; outside the app bundle (`swift run`, tests) they
/// are missing and the controls keep their labels. They match the renderer's: New task
/// `square-pen`, Screenshot `camera` (the composer's screenshot), Commands `command` (the
/// settings Commands section), the drop `file-plus` (the panel's drop overlay).
///
/// Source: the icon nodes of `lucide-react` 1.49.0 (ISC), the version pinned in
/// `pnpm-workspace.yaml`, written out as unmodified 24 × 24 SVGs.
///
/// The Atd mark is the status item's own template image (``StatusItemController``), its idle
/// mark: the Debug build's wider `DevTemplate` adds a DEV label that would not fit a button.
enum MiniPanelIcons {
  static let newTask = "square-pen"
  static let ask = SelectionToolbarIcons.ask
  static let screenshot = "camera"
  static let commands = "command"
  static let drop = "file-plus"

  static func glyph(for control: MiniPanelControl) -> NSImage {
    switch control {
    case .mark:
      let image = NSImage(named: "idleTemplate") ?? NSImage(size: NSSize(width: 18, height: 18))
      image.isTemplate = true
      return image
    case .newTask: return glyph(newTask)
    case .ask: return glyph(ask)
    case .screenshot: return glyph(screenshot)
    case .commands, .row: return glyph(commands)
    }
  }

  /// The Lucide glyph `name`, a template image.
  static func glyph(_ name: String) -> NSImage {
    NSImage(named: "lucide-\(name)") ?? NSImage(size: NSSize(width: 16, height: 16))
  }
}
