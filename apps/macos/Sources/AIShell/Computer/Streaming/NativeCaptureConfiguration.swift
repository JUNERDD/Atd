import CoreMedia
import CoreVideo
import Foundation
@_weakLinked import ScreenCaptureKit

enum NativeCaptureConfiguration {
  /// Keep output allocation fixed while the source changes size. Per-frame geometry supplies
  /// the current content bounds; BGRA can go directly from IOSurface to Core Animation.
  static func make(width: Double, height: Double, cursor: Bool) throws -> SCStreamConfiguration {
    guard width.isFinite, height.isFinite, width > 0, height > 0 else {
      throw CocoaError(.fileReadUnknown)
    }
    let scale = min(1, 1280 / max(width, height))
    let config = SCStreamConfiguration()
    config.width = max(1, Int((width * scale).rounded(.down)))
    config.height = max(1, Int((height * scale).rounded(.down)))
    config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    config.queueDepth = 5
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.scalesToFit = false
    config.preservesAspectRatio = true
    config.showsCursor = cursor
    config.capturesAudio = false
    config.ignoreShadowsSingleWindow = true
    config.captureDynamicRange = .SDR
    return config
  }
}
