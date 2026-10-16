import AppKit
// Weakly linked because the SDK does not mark the classes behind macOS 26's screenshot API
// (`SCScreenshotConfiguration`, `SCScreenshotOutput`) as 26-only: imported normally, they are
// strong references, and dyld refuses to load the app on macOS 15 although ``freeze(_:)`` only
// reaches them under `#available(macOS 26, *)`. Every type this file uses from the module before
// 26 exists on macOS 15, where the framework itself is always present.
@_weakLinked import ScreenCaptureKit

/// Freezes displays with ScreenCaptureKit (decision D6): one screenshot per display with the
/// app's own windows filtered out, so neither the panel, the settings window nor the overlays
/// are ever in the image. Desktop pins are the exception: they belong to the desktop like the
/// system's widgets, which the image shows. Displays are taken one at a time, the one under the
/// cursor first:
/// `replayd` serialises concurrent requests and charges each queued one, so a sequential run
/// gets the cursor's display interactive soonest.
struct DisplayFreezer {
  /// A display ScreenCaptureKit offers, with the screen its overlay goes on.
  struct Target {
    let display: SCDisplay
    let screen: NSScreen
  }

  private let excluded: [SCRunningApplication]
  /// The visible desktop pins, kept although their app is excluded.
  private let pins: [SCWindow]
  /// Displays in capture order: the one under the cursor first.
  let targets: [Target]

  /// The union of every target's Quartz bounds: the capture's desktop.
  var quartzBounds: CGRect {
    targets.map { CGDisplayBounds($0.display.displayID) }.reduce(CGRect.null) { $0.union($1) }
  }

  /// Reads what can be captured. Throws ScreenCaptureKit's error, for example when the Screen
  /// Recording grant no longer matches this build.
  static func prepare() async throws -> DisplayFreezer {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: true)
    let ownPID = ProcessInfo.processInfo.processIdentifier
    let screens = NSScreen.screens
    let cursorID = screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }?
      .displayID
    let targets = content.displays.compactMap { display -> Target? in
      screens.first { $0.displayID == display.displayID }.map {
        Target(display: display, screen: $0)
      }
    }
    let pinNumbers = Set(
      NSApp.windows.filter { $0 is DesktopPinWindow && $0.isVisible }.map(\.windowNumber))
    return DisplayFreezer(
      excluded: content.applications.filter { $0.processID == ownPID },
      pins: content.windows.filter { pinNumbers.contains(Int($0.windowID)) },
      targets: targets.filter { $0.display.displayID == cursorID }
        + targets.filter { $0.display.displayID != cursorID })
  }

  /// The display's pixels at its native scale, without the cursor, in the display's own
  /// colour space (SDR), which is also what the crop exports. Nil when ScreenCaptureKit returns
  /// no SDR image; the caller skips that display.
  func freeze(_ target: Target) async throws -> FrozenDisplay? {
    let filter = SCContentFilter(
      display: target.display, excludingApplications: excluded, exceptingWindows: pins)
    let scale = CGFloat(filter.pointPixelScale)
    let width = Int((filter.contentRect.width * scale).rounded())
    let height = Int((filter.contentRect.height * scale).rounded())
    let image: CGImage?
    if #available(macOS 26, *) {
      image = try await Self.screenshot(filter, width: width, height: height)
    } else {
      image = try await Self.streamImage(filter, width: width, height: height)
    }
    guard let image else { return nil }
    return FrozenDisplay(
      displayID: target.display.displayID, quartzFrame: CGDisplayBounds(target.display.displayID),
      image: image)
  }

  /// macOS 26's screenshot API: an SDR image for the local display, nil when it has none.
  @available(macOS 26, *)
  private static func screenshot(_ filter: SCContentFilter, width: Int, height: Int)
    async throws -> CGImage?
  {
    let configuration = SCScreenshotConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.showsCursor = false
    configuration.dynamicRange = .sdr
    configuration.displayIntent = .local
    let output = try await SCScreenshotManager.captureScreenshot(
      contentFilter: filter, configuration: configuration)
    return output.sdrImage
  }

  /// The same image on macOS 15, through a stream configuration's one-frame capture (macOS 14;
  /// `captureImage(in:)` would need 15.2): SDR at the best resolution, without the cursor, and in
  /// the display's colour space, since `colorSpaceName` is left alone.
  private static func streamImage(_ filter: SCContentFilter, width: Int, height: Int)
    async throws -> CGImage
  {
    let configuration = SCStreamConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.showsCursor = false
    configuration.captureDynamicRange = .SDR
    configuration.captureResolution = .best
    return try await SCScreenshotManager.captureImage(
      contentFilter: filter, configuration: configuration)
  }

  /// ScreenCaptureKit's answer when the user declined or the grant is gone.
  static func isPermissionError(_ error: any Error) -> Bool {
    (error as? SCStreamError)?.code == .userDeclined
  }
}
