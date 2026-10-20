import AICore
import CoreGraphics
import Foundation
@_weakLinked import ScreenCaptureKit

/// A window's own pixels through ScreenCaptureKit (`desktopIndependentWindow`), which keeps
/// capturing a window that is covered, off screen or on another display, but not one on another
/// Space or minimized (plan §4.4). Observations, verification and the preview stream read here;
/// the driver's capture covers another Space.
enum NativeWindowCapture {
  struct Plan {
    let filter: SCContentFilter
    let frame: CGRect
    let pixelWidth: Int
    let pixelHeight: Int
  }

  static func plan(pid: Int, windowId: Int) async throws(ComputerFailure) -> Plan {
    guard pid > 0, windowId > 0 else {
      throw ComputerFailure(.targetChanged, "The capture target is invalid.")
    }
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: false)
      guard let window = content.windows.first(where: { Int($0.windowID) == windowId }),
        window.owningApplication?.processID == pid_t(pid)
      else { throw ComputerFailure(.targetChanged, "The capture window changed or disappeared.") }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let scale = CGFloat(filter.pointPixelScale)
      let width = (filter.contentRect.width * scale).rounded()
      let height = (filter.contentRect.height * scale).rounded()
      guard width.isFinite, height.isFinite, width > 0, height > 0,
        width <= 16384, height <= 16384
      else { throw ComputerFailure(.unsupported, "The capture window has invalid dimensions.") }
      return Plan(
        filter: filter, frame: window.frame, pixelWidth: Int(width), pixelHeight: Int(height))
    } catch let failure as ComputerFailure {
      throw failure
    } catch {
      throw ComputerFailure(
        .unsupported, "The window cannot be captured: \(error.localizedDescription)")
    }
  }

  /// One still of the window at its native resolution, with the window's frame (Quartz global
  /// points) the capture was planned for.
  struct Shot {
    let image: CGImage
    let frame: CGRect
  }

  static func capture(pid: Int, windowId: Int) async throws(ComputerFailure) -> Shot {
    let plan = try await plan(pid: pid, windowId: windowId)
    let configuration = SCStreamConfiguration()
    configuration.width = plan.pixelWidth
    configuration.height = plan.pixelHeight
    configuration.showsCursor = false
    configuration.ignoreShadowsSingleWindow = true
    configuration.captureDynamicRange = .SDR
    do {
      let image = try await SCScreenshotManager.captureImage(
        contentFilter: plan.filter, configuration: configuration)
      return Shot(image: image, frame: plan.frame)
    } catch {
      throw ComputerFailure(
        .unsupported, "The window screenshot failed: \(error.localizedDescription)")
    }
  }
}
