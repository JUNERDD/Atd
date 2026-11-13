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

  /// Applied outside a surface's glass container so its material fades with its content.
  static func popoverOpacity(_ presented: Bool) -> Animation {
    presented
      ? MiniPanelChoreography.contentOpacity.animation
      : .easeIn(duration: MiniPanelChoreography.labelText.exit)
  }
}

nonisolated extension MiniPanelSpring {
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
  var animation: Animation { animation(thickness: .horizontal) }

  /// The shape moving as one value, its thickness running along `axis` (the command island's
  /// is its height).
  func animation(thickness axis: MiniPanelShapeAxis) -> Animation {
    Animation(MiniPanelAxisAnimation(motion: self, axis: axis))
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
