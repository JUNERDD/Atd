import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import AtdAI

/// `ImageEncoding`, which prepares the photos card commands send, and every other prompt's.
@Suite struct CardImageTests {
  /// A one-color image of `width` × `height` stored pixels, encoded as `type`, which viewers
  /// turn by its EXIF `orientation`.
  private func image(width: Int, height: Int, orientation: Int = 1, type: UTType = .jpeg)
    throws -> Data
  {
    let space = try #require(CGColorSpace(name: CGColorSpace.sRGB))
    let context = try #require(
      CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
    context.setFillColor(red: 0.9, green: 0.4, blue: 0.1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let pixels = try #require(context.makeImage())
    let data = NSMutableData()
    let destination = try #require(
      CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(
      destination, pixels, [kCGImagePropertyOrientation: orientation] as CFDictionary)
    try #require(CGImageDestinationFinalize(destination))
    return data as Data
  }

  /// The pixel size of encoded image data, as stored.
  private func size(of data: Data) throws -> [Int] {
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    let properties = try #require(
      CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    return [kCGImagePropertyPixelWidth, kCGImagePropertyPixelHeight].compactMap {
      properties[$0] as? Int
    }
  }

  @Test func aLargePhotoShrinksToTheLongSideLimit() async throws {
    let photo = try image(width: 4032, height: 3024)
    let encoded = try #require(await ImageEncoding.modelImage(from: photo))
    #expect(encoded.mediaType == "image/jpeg")
    #expect(try size(of: encoded.data) == [ImageEncoding.maxPixels, 1176])
  }

  @Test func aSmallScreenshotKeepsItsSizeAndBecomesJPEG() async throws {
    let screenshot = try image(width: 300, height: 120, type: .png)
    let encoded = try #require(await ImageEncoding.modelImage(from: screenshot))
    #expect(try size(of: encoded.data) == [300, 120])
    #expect(encoded.data.prefix(3) == Data([0xFF, 0xD8, 0xFF]))
  }

  /// A photo taken with the phone on its side is stored sideways and comes out upright.
  @Test func aTurnedPhotoComesOutUpright() async throws {
    let sideways = try image(width: 400, height: 200, orientation: 6)
    let encoded = try #require(await ImageEncoding.modelImage(from: sideways))
    #expect(try size(of: encoded.data) == [200, 400])
  }

  @Test func dataThatIsNoImageGivesNothing() async {
    #expect(await ImageEncoding.modelImage(from: Data("not an image".utf8)) == nil)
    #expect(await ImageEncoding.modelImage(from: Data()) == nil)
  }
}
