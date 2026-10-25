import AICore
import CoreGraphics
import Foundation
import ImageIO

/// One newest display image. Native frames stay in their raw store; browser decoding never
/// runs on the UI executor and never keeps an image history.
final class ComputerMonitorSource {
  /// What a source shows, which its caption names with a symbol.
  enum Kind {
    /// The task's shared screen, which has no target reference.
    case sharedScreen
    /// An application or one of its windows.
    case application
    /// A page in the computer-use browser.
    case browser

    var symbolName: String {
      switch self {
      case .sharedScreen: "display"
      case .application: "macwindow"
      case .browser: "globe"
      }
    }
  }

  let id: String
  let label: String
  let kind: Kind
  private(set) var frames: NativeCaptureFrames?
  private(set) var image: CGImage?
  private(set) var reason: PreviewReason? = .starting
  var onChange: (() -> Void)?
  private var sequence = 0
  private var revision = 0

  init(id: String, label: String, kind: Kind) {
    self.id = id
    self.label = label
    self.kind = kind
  }

  /// Frames are showing: no reason stands in for the picture.
  var isLive: Bool { reason == nil }

  func attach(_ frames: NativeCaptureFrames?) {
    self.frames = frames
    reason = frames == nil ? .starting : frames?.snapshot.unavailable
    onChange?()
  }

  func setReason(_ reason: PreviewReason?) {
    guard self.reason != reason else { return }
    self.reason = reason
    onChange?()
  }

  func clear(_ reason: PreviewReason) {
    revision += 1
    sequence = 0
    frames = nil
    image = nil
    self.reason = reason
    onChange?()
  }

  func clearImage() {
    revision += 1
    sequence = 0
    image = nil
    onChange?()
  }

  func present(_ frame: ComputerPreviewFrame?, admitted: () -> Bool) async throws {
    guard let frame else {
      clear(.starting)
      return
    }
    guard frame.sequence != sequence else { return }
    let current = revision
    let decoded = await Task.detached(priority: .userInitiated) {
      guard let source = CGImageSourceCreateWithData(frame.data as CFData, nil) else {
        return nil as CGImage?
      }
      return CGImageSourceCreateImageAtIndex(
        source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }.value
    guard revision == current, admitted(), !Task.isCancelled else { return }
    guard let decoded else {
      throw ComputerFailure(.unsupported, "The browser preview image could not be decoded.")
    }
    image = decoded
    sequence = frame.sequence
    reason = nil
    onChange?()
  }
}
