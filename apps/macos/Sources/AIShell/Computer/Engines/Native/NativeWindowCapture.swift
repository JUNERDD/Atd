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
    let pixelScale: CGFloat
    // Preview allocation follows the filter; still captures use the logical window size.
    let pixelWidth: Int
    let pixelHeight: Int
  }

  static func plan(pid: Int, windowId: Int) async throws(ComputerFailure) -> Plan {
    guard pid > 0, windowId > 0 else {
      throw ComputerFailure(.targetChanged, "The capture target is invalid.")
    }
    let frame = try windowFrame(pid: pid, windowId: windowId)
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: false)
      guard let window = content.windows.first(where: { Int($0.windowID) == windowId }),
        window.owningApplication?.processID == pid_t(pid)
      else { throw ComputerFailure(.targetChanged, "The capture window changed or disappeared.") }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let scale = CGFloat(filter.pointPixelScale)
      let pixels = try pixelSize(filter.contentRect.size, scale: scale)
      // Check the source before configuring output: resizing must not conceal a cropped or
      // differently proportioned source. CG bounds own the coordinate mapping used by input.
      guard NativeCapture.scale(frame: frame, width: pixels.width, height: pixels.height) != nil
      else {
        throw ComputerFailure(
          .staleObservation, "The capture content geometry does not match its window.")
      }
      try validateFrame(frame, pid: pid, windowId: windowId)
      return Plan(
        filter: filter, frame: frame, pixelScale: scale,
        pixelWidth: pixels.width, pixelHeight: pixels.height)
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
    let pixels = try pixelSize(plan.frame.size, scale: plan.pixelScale)
    let configuration = SCStreamConfiguration()
    configuration.width = pixels.width
    configuration.height = pixels.height
    configuration.scalesToFit = true
    configuration.preservesAspectRatio = true
    configuration.showsCursor = false
    configuration.ignoreShadowsSingleWindow = true
    configuration.captureDynamicRange = .SDR
    do {
      let image = try await SCScreenshotManager.captureImage(
        contentFilter: plan.filter, configuration: configuration)
      try validateFrame(plan.frame, pid: pid, windowId: windowId)
      guard image.width == pixels.width, image.height == pixels.height else {
        throw ComputerFailure(
          .staleObservation, "The screenshot dimensions do not match the planned window capture.")
      }
      return Shot(image: image, frame: plan.frame)
    } catch let failure as ComputerFailure {
      throw failure
    } catch {
      throw ComputerFailure(
        .unsupported, "The window screenshot failed: \(error.localizedDescription)")
    }
  }

  private static func pixelSize(_ size: CGSize, scale: CGFloat) throws(ComputerFailure) -> (
    width: Int, height: Int
  ) {
    let width = (size.width * scale).rounded()
    let height = (size.height * scale).rounded()
    guard scale.isFinite, scale > 0, width.isFinite, height.isFinite,
      width > 0, height > 0, width <= 16384, height <= 16384
    else { throw ComputerFailure(.unsupported, "The capture window has invalid dimensions.") }
    return (Int(width), Int(height))
  }

  private static func windowFrame(pid: Int, windowId: Int) throws(ComputerFailure) -> CGRect {
    guard let frame = NativeSurfaceProbe.frame(windowId: windowId, pid: pid_t(pid)),
      [frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite),
      frame.width > 0, frame.height > 0
    else { throw ComputerFailure(.targetChanged, "The capture window changed or disappeared.") }
    return frame
  }

  private static func validateFrame(_ planned: CGRect, pid: Int, windowId: Int)
    throws(ComputerFailure)
  {
    let live = try windowFrame(pid: pid, windowId: windowId)
    let tolerance = NativeCapture.tolerance
    guard abs(live.minX - planned.minX) <= tolerance,
      abs(live.minY - planned.minY) <= tolerance,
      abs(live.width - planned.width) <= tolerance,
      abs(live.height - planned.height) <= tolerance
    else {
      throw ComputerFailure(
        .staleObservation, "The window geometry changed while preparing or taking its capture.")
    }
  }
}
