import AICore
import AVFoundation
import AppKit
@_weakLinked import ScreenCaptureKit

/// The microphone grant, asked the first time a recording needs the microphone: macOS shows its
/// prompt with `NSMicrophoneUsageDescription` once, and answers from the setting afterwards.
enum MicrophoneAccess {
  /// Returns once Atd may record the microphone; ``RecordingError/microphoneDenied`` when the
  /// user said no now or before, or a policy restricts it.
  static func request() async throws(RecordingError) {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return
    case .notDetermined:
      guard await AVCaptureDevice.requestAccess(for: .audio) else { throw .microphoneDenied }
    default: throw .microphoneDenied
    }
  }
}

/// What ScreenCaptureKit is asked for: which windows the video leaves out and how the stream
/// reads, scales and hears.
enum RecordingStreamSettings {
  /// The display without Atd's own windows, as ``DisplayFreezer`` filters it, except the visible
  /// desktop pins (they belong to the desktop) and the windows in `kept` (the key badges).
  static func filter(display: SCDisplay, content: SCShareableContent, keeping kept: Set<Int>)
    -> SCContentFilter
  {
    let ownPID = ProcessInfo.processInfo.processIdentifier
    let pins = Set(
      NSApp.windows.filter { $0 is DesktopPinWindow && $0.isVisible }.map(\.windowNumber))
    let keptNumbers = pins.union(kept)
    return SCContentFilter(
      display: display,
      excludingApplications: content.applications.filter { $0.processID == ownPID },
      exceptingWindows: content.windows.filter { keptNumbers.contains(Int($0.windowID)) })
  }

  /// The stream for `plan`: BGRA in sRGB (the movie is tagged Rec. 709, whose primaries sRGB
  /// shares; click circles draw only on BGRA), the plan's rect scaled to its pixels without
  /// letterboxing, at its frame rate, with the pointer, click circles and system audio as
  /// `config` asks (Atd's own sounds left out), and the microphone `microphoneID` when given.
  static func configuration(
    _ plan: RecordingStreamPlan, _ config: RecordingConfig, microphoneID: String?
  ) -> SCStreamConfiguration {
    let configuration = SCStreamConfiguration()
    configuration.width = plan.pixelWidth
    configuration.height = plan.pixelHeight
    configuration.sourceRect = plan.sourceRect
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(plan.fps))
    configuration.queueDepth = 8
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.colorSpaceName = CGColorSpace.sRGB
    configuration.captureDynamicRange = .SDR
    configuration.captureResolution = .best
    // The plan rounds both sides to even pixels; stretching by under a pixel beats a black edge.
    configuration.preservesAspectRatio = false
    configuration.showsCursor = config.showsPointer
    configuration.showMouseClicks = config.showsClicks
    configuration.capturesAudio = config.systemAudio
    configuration.sampleRate = 48_000
    configuration.channelCount = 2
    configuration.excludesCurrentProcessAudio = true
    configuration.captureMicrophone = microphoneID != nil
    configuration.microphoneCaptureDeviceID = microphoneID
    return configuration
  }
}
