import AICore
import CoreGraphics
import CoreVideo
import Testing

@testable import AIShell

@Suite("LongScreenshotEngine pixel-exact scroll-area bridging (H11)")
struct LongScreenshotEngineBridgeTests {
  private static func makeFrameBuffer(
    geometry: LongScreenshotGeometry, position: Int
  ) throws -> CVPixelBuffer {
    var pixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault, geometry.width, geometry.height, kCVPixelFormatType_32BGRA, nil,
      &pixelBuffer)
    let buffer = try #require(status == kCVReturnSuccess ? pixelBuffer : nil)
    #expect(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let base = try #require(CVPixelBufferGetBaseAddress(buffer))
    let bpr = CVPixelBufferGetBytesPerRow(buffer)
    let head = geometry.headRows.count

    for y in 0..<geometry.height {
      let docRow = position + (y - head)
      let encoded = docRow + 2_048
      let rowPtr = base.advanced(by: y * bpr).assumingMemoryBound(to: UInt8.self)
      for x in 0..<geometry.width {
        let p = x * 4
        if x == 0 {
          rowPtr[p] = UInt8(encoded & 0xFF)
          rowPtr[p + 1] = UInt8((encoded >> 8) & 0xFF)
          rowPtr[p + 2] = 0x42
          rowPtr[p + 3] = 0xFF
        } else {
          rowPtr[p] = UInt8(truncatingIfNeeded: encoded &* 31 &+ x &* 17)
          rowPtr[p + 1] = UInt8(truncatingIfNeeded: (encoded >> 3) &+ x &* 13)
          rowPtr[p + 2] = UInt8(truncatingIfNeeded: encoded ^ (x &* 29))
          rowPtr[p + 3] = 0xFF
        }
      }
    }
    return buffer
  }

  @Test("H11: Engine composes pixel-exact rows across >bandHeight downward and upward jumps")
  func engineComposesGaplessPixelsAcrossDualFrameJumps() async throws {
    // Selection: 203px tall with small 20px headRows and 377px tailRows -> forces dual-frame
    // previousBelow + below on +360 jumps, and dual-frame previousAbove + above when tail is small!
    let selection = CGRect(x: 0, y: 20, width: 240, height: 203)
    let scrollArea = CGRect(x: 0, y: 0, width: 240, height: 600)
    let geometry = try #require(
      LongScreenshotGeometry.make(
        selection: selection, scrollArea: scrollArea, displaySize: CGSize(width: 800, height: 800),
        scale: 1))
    let engine = LongScreenshotEngine(geometry: geometry, scrollValue: nil, changed: {})

    // Frame 0 at position 0, then +360 -> +720 (> 203px band!), back to 0, then -360 upward!
    engine.receive(try Self.makeFrameBuffer(geometry: geometry, position: 0), at: 0.0)
    let steps: [(Double, LongScreenshotDirection, Int)] = [
      (0.1, .down, 360),
      (0.2, .down, 720),
      (0.3, .up, 360),
      (0.4, .up, 0),
      (0.5, .up, -360),
    ]
    for (t, dir, pos) in steps {
      engine.request(dir, points: 360, auto: false, at: t)
      engine.receive(try Self.makeFrameBuffer(geometry: geometry, position: pos), at: t + 0.02)
    }

    let parts = try #require(engine.take())
    // Expected document range: [-360, 720 + 203) = -360..<923 -> 1,283 exact rows, zero head/tail!
    #expect(parts.layout.height == 1_283)
    let composed = try #require(await LongScreenshotRender.compose(parts, pointScale: 1))
    #expect(composed.image.width == 240)
    #expect(composed.image.height == 1_283)

    var pixels = [UInt8](repeating: 0, count: 240 * 1_283 * 4)
    let readCtx = try #require(
      CGContext(
        data: &pixels, width: 240, height: 1_283, bitsPerComponent: 8, bytesPerRow: 240 * 4,
        space: parts.space, bitmapInfo: LongScreenshotRows.bitmapInfo.rawValue))
    readCtx.draw(composed.image, in: CGRect(x: 0, y: 0, width: 240, height: 1_283))

    for outY in 0..<1_283 {
      let offset = outY * 240 * 4
      let decoded = (Int(pixels[offset]) | (Int(pixels[offset + 1]) << 8)) - 2_048
      let expectedDocRow = -360 + outY
      if decoded != expectedDocRow {
        Issue.record("Row \(outY) expected docRow \(expectedDocRow), got \(decoded)")
        break
      }
    }
  }
}
