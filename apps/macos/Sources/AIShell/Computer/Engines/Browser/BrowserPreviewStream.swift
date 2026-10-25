import AICore
import Foundation
import ImageIO
import MCP
import UniformTypeIdentifiers

/// Exact-page JPEG transport. Keep one validated revision; presentation decodes it natively.
final class BrowserPreviewStream: ComputerPreviewStream {
  private let previewId: String
  private weak var engine: PlaywrightBrowserEngine?
  private let instance: ManagedChromeInstance
  private let generation: Int
  private var stopped = false
  private var cached: ComputerPreviewFrame?

  init(
    previewId: String, engine: PlaywrightBrowserEngine, instance: ManagedChromeInstance,
    generation: Int
  ) {
    self.previewId = previewId
    self.engine = engine
    self.instance = instance
    self.generation = generation
  }

  func latest() async throws -> ComputerPreviewFrame? {
    guard !stopped, let engine else { throw PlaywrightBrowserEngine.surfaceGone }
    let (raw, _) = try await engine.call(
      instance, "preview_read", ["previewId": .string(previewId)], timeout: .seconds(3),
      writes: false, pinned: generation)
    let reply = try engine.checked(raw, "preview_read")
    guard !stopped, reply.previewId == previewId else { throw PlaywrightBrowserEngine.surfaceGone }
    guard let frame = reply.frame else { return cached }
    if frame.sequence == cached?.sequence { return cached }
    guard frame.sequence > 0, frame.sequence > (cached?.sequence ?? 0), frame.capturedAt.isFinite,
      frame.capturedAt > 0, frame.base64.utf8.count <= 1_398_104,
      let data = Data(base64Encoded: frame.base64), !data.isEmpty, data.count <= 1_048_576,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      CGImageSourceGetType(source).map({ $0 as String }) == UTType.jpeg.identifier,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      (1...1280).contains(width), (1...1280).contains(height)
    else { throw ComputerFailure(.unsupported, "The browser preview frame exceeded its bounds.") }
    let result = ComputerPreviewFrame(
      sequence: frame.sequence, capturedAt: Date(timeIntervalSince1970: frame.capturedAt / 1000),
      width: width, height: height, data: data)
    cached = result
    return result
  }

  func stop() async {
    guard !stopped else { return }
    stopped = true
    cached = nil
    guard let engine,
      engine.workers.generation(profileId: instance.profileId, contextId: instance.contextId)
        == generation
    else { return }
    _ = try? await engine.call(
      instance, "preview_stop", ["previewId": .string(previewId)], timeout: .seconds(3),
      writes: false, pinned: generation)
  }
}
