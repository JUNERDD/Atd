import AtdAI
import AtdModel
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import Synchronization
import UniformTypeIdentifiers

/// Photos for the camera tests, drawn in code: dark text on white, one line under another, as a
/// sign or a menu photographs.
enum CameraFixtures {
  static let width = 1200
  static let height = 900

  /// `lines` drawn top to bottom, 150 px apart, from 80 px in.
  static func image(lines: [String], width: Int = width, height: Int = height) -> CGImage? {
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    guard let font = CTFontCreateUIFontForLanguage(.system, 72, nil) else { return nil }
    for (index, line) in lines.enumerated() {
      let text = NSAttributedString(
        string: line, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
      // Core Graphics counts from the bottom; the first line goes at the top.
      context.textPosition = CGPoint(x: 80, y: CGFloat(height - 160 - index * 150))
      CTLineDraw(CTLineCreateWithAttributedString(text), context)
    }
    return context.makeImage()
  }

  /// `image` as a JPEG whose metadata says how to turn it upright, as a camera writes it.
  static func jpeg(_ image: CGImage, orientation: CGImagePropertyOrientation = .up) -> Data? {
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    let properties: [CFString: Any] = [
      kCGImagePropertyOrientation: orientation.rawValue,
      kCGImageDestinationLossyCompressionQuality: 0.9,
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
  }

  static func photo(lines: [String]) -> Data? {
    image(lines: lines).flatMap { jpeg($0) }
  }

  /// A read photo with lines at known places, for runs and drawings that need no Vision.
  static func lines(_ texts: [String]) -> [CameraTextLine] {
    texts.enumerated().map { index, text in
      CameraTextLine(
        id: index + 1, text: text,
        quad: CameraQuad(
          CGRect(x: 0.08, y: 0.1 + CGFloat(index) * 0.16, width: 0.6, height: 0.1)))
    }
  }
}

/// Answers each request from a script, in order: pieces and the end, a failure, or pieces with
/// the stream held open until `finish(with:)`. Keeps every request it was sent.
final class CameraGenerator: TextGenerating {
  enum Reply: Sendable {
    case text([String])
    case failure(ModelFailure)
    case held([String])
  }

  private struct State {
    var replies: [Reply]
    var requests: [ModelRequest] = []
    var held: AsyncThrowingStream<String, any Error>.Continuation?
  }

  private let state: Mutex<State>

  init(_ replies: Reply...) {
    state = Mutex(State(replies: replies))
  }

  var requests: [ModelRequest] { state.withLock { $0.requests } }

  /// Sends `pieces` on the held stream, then ends it.
  func finish(with pieces: [String]) {
    let held = state.withLock { state in
      defer { state.held = nil }
      return state.held
    }
    for piece in pieces { held?.yield(piece) }
    held?.finish()
  }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
    let reply = state.withLock { state in
      state.requests.append(request)
      return state.replies.isEmpty
        ? Reply.failure(.unreadable(detail: "unscripted")) : state.replies.removeFirst()
    }
    switch reply {
    case .text(let pieces):
      for piece in pieces { continuation.yield(piece) }
      continuation.finish()
    case .failure(let failure):
      continuation.finish(throwing: failure)
    case .held(let pieces):
      for piece in pieces { continuation.yield(piece) }
      state.withLock { $0.held = continuation }
    }
    return stream
  }
}

/// Waits until `condition` holds, checking every 20 ms; false after `timeout`.
@MainActor
func eventually(timeout: Duration = .seconds(20), _ condition: () -> Bool) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: timeout)
  while !condition() {
    guard clock.now < deadline else { return false }
    try? await Task.sleep(for: .milliseconds(20))
  }
  return true
}
