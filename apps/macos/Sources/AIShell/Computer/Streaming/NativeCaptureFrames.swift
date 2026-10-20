import AICore
import CoreGraphics
import CoreMedia
import Foundation
@_weakLinked import ScreenCaptureKit
import Synchronization

/// One newest raw frame, one display consumer, and at most one in-flight snapshot encode.
/// Capture never waits for display or encoding. Invalidations revoke admitted pixels before
/// asynchronous teardown; an idle callback only confirms unchanged content.
nonisolated final class NativeCaptureFrames: NSObject, SCStreamOutput, Sendable {
  struct Snapshot: Sendable {
    var sequence = 0
    var checkedAt = Date()
    var frame: NativeCaptureFrame?
    var unavailable: ScreenShareReplyWire.Unavailable? = .starting
  }

  struct Statistics: Sendable {
    var receivedFrames = 0
    var replacedFrames = 0
    var invalidations = 0
    var encodedSnapshots = 0
    var encodingFailures = 0
  }

  private struct Encoding: Sendable {
    let revision: Int
    let sequence: Int
    let task: Task<ComputerPreviewFrame?, Never>
  }

  private enum ImageRequest {
    case cached(ComputerPreviewFrame)
    case encoding(Encoding)
  }

  private struct State {
    var stopped = false
    var streamActive = true
    var revision = 0
    var snapshot = Snapshot()
    var statistics = Statistics()
    var encoding: Encoding?
    var image: ComputerPreviewFrame?
  }

  let queue = DispatchQueue(label: "com.junerdd.ai.capture-frames", qos: .userInitiated)
  private let imageQueue = DispatchQueue(label: "com.junerdd.ai.capture-snapshot", qos: .utility)
  private let state = Mutex(State())
  private let encoder = NativeFrameEncoder()
  private let crop: CGRect?

  init(crop: CGRect? = nil) { self.crop = crop }

  var snapshot: Snapshot {
    if Self.isLocked { invalidate(.locked) }
    return state.withLock { $0.snapshot }
  }

  var statistics: Statistics { state.withLock { $0.statistics } }

  private static var isLocked: Bool {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    return (session?["CGSSessionScreenIsLocked"] as? Bool) == true
  }

  func invalidate(_ reason: ScreenShareReplyWire.Unavailable) {
    state.withLock { Self.invalidate(reason, state: &$0) }
  }

  /// Delegate activity changes can precede already queued sample callbacks. Keep those callbacks
  /// from readmitting the old source until the matching active notification arrives.
  func setStreamActive(_ active: Bool) {
    state.withLock {
      $0.streamActive = active
      Self.invalidate(active ? .starting : .suspended, state: &$0)
    }
  }

  private static func invalidate(_ reason: ScreenShareReplyWire.Unavailable, state: inout State) {
    guard !state.stopped else { return }
    state.snapshot.checkedAt = .now
    guard state.snapshot.frame != nil || state.snapshot.unavailable != reason else { return }
    state.revision += 1
    state.statistics.invalidations += 1
    state.snapshot.frame = nil
    state.snapshot.unavailable = reason
    state.image = nil
  }

  func stop() {
    state.withLock {
      guard !$0.stopped else { return }
      $0.stopped = true
      $0.revision += 1
      $0.snapshot.frame = nil
      $0.snapshot.unavailable = .captureFailed
      $0.snapshot.checkedAt = .now
      $0.image = nil
    }
  }

  /// Concurrent callers share one encode. A newer capture does not invalidate a snapshot that
  /// was current when requested, but a source invalidation during encoding always revokes it.
  func image() async -> ComputerPreviewFrame? {
    if Self.isLocked { invalidate(.locked) }
    let request: ImageRequest? = state.withLock {
      guard !$0.stopped, $0.snapshot.unavailable == nil, let frame = $0.snapshot.frame else {
        return nil
      }
      if let image = $0.image, image.sequence == frame.sequence { return .cached(image) }
      if let encoding = $0.encoding { return .encoding(encoding) }
      let encoding = Encoding(
        revision: $0.revision, sequence: frame.sequence,
        task: Task { [encoder, imageQueue] in
          await withCheckedContinuation { continuation in
            imageQueue.async {
              let image = autoreleasepool { encoder.encode(frame) }
              continuation.resume(
                returning: image.map {
                  ComputerPreviewFrame(
                    sequence: frame.sequence, capturedAt: frame.capturedAt,
                    width: $0.width, height: $0.height, data: $0.data)
                })
            }
          }
        })
      $0.encoding = encoding
      return .encoding(encoding)
    }
    guard let request else { return nil }
    switch request {
    case .cached(let image):
      return Task.isCancelled ? nil : image
    case .encoding(let work):
      let image = await work.task.value
      if Self.isLocked { invalidate(.locked) }
      return state.withLock {
        if $0.encoding?.sequence == work.sequence, $0.encoding?.revision == work.revision {
          $0.encoding = nil
          if image == nil {
            $0.statistics.encodingFailures += 1
          } else {
            $0.statistics.encodedSnapshots += 1
          }
        }
        guard !$0.stopped, $0.revision == work.revision, $0.snapshot.unavailable == nil else {
          return nil
        }
        if let image, ($0.image?.sequence ?? -1) < image.sequence { $0.image = image }
        return Task.isCancelled ? nil : image
      }
    }
  }

  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, !state.withLock({ $0.stopped }) else { return }
    guard !Self.isLocked else {
      invalidate(.locked)
      return
    }
    guard sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let info = attachments.first, let raw = info[.status] as? Int,
      let status = SCFrameStatus(rawValue: raw)
    else {
      invalidate(.captureFailed)
      return
    }
    switch status {
    case .idle:
      state.withLock { if !$0.stopped { $0.snapshot.checkedAt = .now } }
    case .blank: invalidate(.blank)
    case .suspended: invalidate(.suspended)
    case .stopped: invalidate(.captureFailed)
    case .started: invalidate(.starting)
    case .complete: receive(sampleBuffer, attachments: info)
    @unknown default: invalidate(.captureFailed)
    }
  }

  private func receive(_ sample: CMSampleBuffer, attachments: [SCStreamFrameInfo: Any]) {
    let admission = state.withLock { ($0.revision, $0.snapshot.sequence + 1) }
    guard let buffer = sample.imageBuffer,
      let frame = NativeCaptureFrame(
        sequence: admission.1, capturedAt: .now, buffer: buffer,
        attachments: attachments, crop: crop)
    else {
      invalidate(.captureFailed)
      return
    }
    state.withLock {
      guard !$0.stopped, $0.streamActive, $0.revision == admission.0 else { return }
      $0.statistics.receivedFrames += 1
      if $0.snapshot.frame != nil { $0.statistics.replacedFrames += 1 }
      $0.snapshot.checkedAt = .now
      $0.snapshot.unavailable = nil
      $0.snapshot.sequence = frame.sequence
      $0.snapshot.frame = frame
    }
  }
}
