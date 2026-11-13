import Foundation

/// What one screen recording captures, in the engine's own terms (decision R5). The recording
/// orchestrator maps the remembered recording settings and the capture session's record request
/// onto it; the engine reads nothing else.
public struct RecordingConfig: Equatable, Sendable {
  /// The display recorded (`CGDirectDisplayID`).
  public var displayID: UInt32
  /// The region recorded, in that display's points with the origin at its top-left and y down.
  /// The planner clamps it to the display (``RecordingStreamPlan``).
  public var rect: CGRect
  /// Frames per second: 60 records at 60, anything else at 30.
  public var fps: Int
  /// The widest output the chosen quality allows, in pixels (1280 for 720p, 1920 for 1080p),
  /// or nil to keep the display's own pixels.
  public var maxOutputWidth: Int?
  /// The microphone recorded from the start (`AVCaptureDevice.uniqueID`), or nil for none. The
  /// recorder can turn a microphone on and off while it records.
  public var microphoneID: String?
  /// Whether the system's audio output is recorded (Atd's own sounds are left out).
  public var systemAudio: Bool
  /// Whether the video shows the pointer.
  public var showsPointer: Bool
  /// Whether the video circles the pointer on each click.
  public var showsClicks: Bool
  /// Whether key presses show as badges in the video. The input log records keys either way.
  public var showsKeys: Bool
  /// The app under the selection when the capture began, for the result's title; nil when none
  /// is known, and the app in front when recording starts stands in.
  public var appName: String?

  public init(
    displayID: UInt32, rect: CGRect, fps: Int, maxOutputWidth: Int?, microphoneID: String?,
    systemAudio: Bool, showsPointer: Bool, showsClicks: Bool, showsKeys: Bool,
    appName: String? = nil
  ) {
    self.displayID = displayID
    self.rect = rect
    self.fps = fps
    self.maxOutputWidth = maxOutputWidth
    self.microphoneID = microphoneID
    self.systemAudio = systemAudio
    self.showsPointer = showsPointer
    self.showsClicks = showsClicks
    self.showsKeys = showsKeys
    self.appName = appName
  }
}

/// The stream geometry and encoding of a ``RecordingConfig`` on its display: the rect
/// ScreenCaptureKit reads (`SCStreamConfiguration.sourceRect`, display points) and the pixel
/// size it scales that rect to (`width`, `height`), which is also the movie's.
public struct RecordingStreamPlan: Equatable, Sendable {
  /// The rect read, on the display's pixel grid and within the display.
  public var sourceRect: CGRect
  /// The output's pixels, both even, as H.264's 4:2:0 sampling needs.
  public var pixelWidth: Int
  public var pixelHeight: Int
  /// 30 or 60.
  public var fps: Int
  /// The video's average bit rate in bits per second.
  public var averageBitRate: Int

  /// The largest frame the H.264 hardware encoders take (level 5.2): a 5K or 6K display's own
  /// pixels are scaled into it.
  public static let maxLongSide = 4096
  public static let maxShortSide = 2304
  /// Bits per pixel per frame at 30 fps. 60 fps takes 1.6 times the 30 fps rate, as the size
  /// estimate in the recording options does; screen content compresses well, so this matches
  /// about 50 MB a minute at 1920 × 1080.
  static let bitsPerPixel = 0.1
  /// Small regions keep enough bits for legible text.
  public static let minimumBitRate = 1_000_000

  /// The plan for `config` on a display of `displaySize` points at `scale` pixels per point;
  /// nil when the rect leaves less than two pixels of the display in either direction.
  ///
  /// The rect is cut to the display and widened to whole pixels. The output keeps those pixels
  /// unless the quality caps them: `maxOutputWidth` bounds the long side and nine sixteenths of
  /// it the short side (so 1080p is at most 1920 × 1080 for a wide region, 1080 × 1920 for a tall
  /// one), and ``maxLongSide`` / ``maxShortSide`` bound every quality. Nothing is scaled up. An
  /// unscaled output drops the odd pixel from the read rect, so it is never stretched.
  public static func make(_ config: RecordingConfig, displaySize: CGSize, scale: CGFloat)
    -> RecordingStreamPlan?
  {
    guard
      let pixels = DisplayPixelGrid.pixels(of: config.rect, displaySize: displaySize, scale: scale)
    else { return nil }
    let minX = pixels.minX
    let minY = pixels.minY
    var width = pixels.width
    var height = pixels.height
    guard width >= 2, height >= 2 else { return nil }
    let factor = outputFactor(width: width, height: height, maxOutputWidth: config.maxOutputWidth)
    let pixelWidth = even(width * factor)
    let pixelHeight = even(height * factor)
    if factor >= 1 {
      width = CGFloat(pixelWidth)
      height = CGFloat(pixelHeight)
    }
    let fps = config.fps >= 60 ? 60 : 30
    let rate = Double(pixelWidth * pixelHeight) * 30 * bitsPerPixel * (fps == 60 ? 1.6 : 1)
    return RecordingStreamPlan(
      sourceRect: CGRect(
        x: minX / scale, y: minY / scale, width: width / scale, height: height / scale),
      pixelWidth: pixelWidth, pixelHeight: pixelHeight, fps: fps,
      averageBitRate: max(minimumBitRate, Int(rate)))
  }

  /// The scale from the read pixels to the output's, at most 1.
  private static func outputFactor(width: CGFloat, height: CGFloat, maxOutputWidth: Int?)
    -> CGFloat
  {
    let long = max(width, height)
    let short = min(width, height)
    var factor = min(1, CGFloat(maxLongSide) / long, CGFloat(maxShortSide) / short)
    if let maxOutputWidth, maxOutputWidth > 0 {
      let cap = CGFloat(maxOutputWidth)
      factor = min(factor, cap / long, cap * 9 / 16 / short)
    }
    return factor
  }

  /// `value` rounded down to an even number, at least 2.
  private static func even(_ value: CGFloat) -> Int {
    max(2, Int(value.rounded(.down)) & ~1)
  }
}

/// A display's pixel grid, which ScreenCaptureKit reads without resampling: a recording's region
/// and a long screenshot's stream both read whole pixels of their display.
public enum DisplayPixelGrid {
  /// `rect` (display points, origin top-left) cut to a display of `displaySize` points and
  /// widened to whole pixels at `scale` pixels per point, in pixels; nil when nothing of the
  /// display remains or the display or scale is empty. Either side may come out under one pixel.
  public static func pixels(of rect: CGRect, displaySize: CGSize, scale: CGFloat) -> CGRect? {
    guard scale > 0, displaySize.width > 0, displaySize.height > 0 else { return nil }
    let display = CGRect(origin: .zero, size: displaySize)
    let cut = rect.standardized.intersection(display)
    guard !cut.isNull else { return nil }
    let maxPixelX = (displaySize.width * scale).rounded(.down)
    let maxPixelY = (displaySize.height * scale).rounded(.down)
    let minX = max(0, (cut.minX * scale).rounded(.down))
    let minY = max(0, (cut.minY * scale).rounded(.down))
    return CGRect(
      x: minX, y: minY, width: min(maxPixelX, (cut.maxX * scale).rounded(.up)) - minX,
      height: min(maxPixelY, (cut.maxY * scale).rounded(.up)) - minY)
  }
}
