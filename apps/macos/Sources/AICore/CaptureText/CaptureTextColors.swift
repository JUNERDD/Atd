import CoreGraphics
import Foundation

/// The colours of a paragraph as the screenshot shows it, for the plate and the glyphs of the text
/// that replaces it in place (``CaptureTextMarks/translation(_:over:colors:measure:)``): the
/// background is the most common colour along the region's edge, where text rarely reaches, and
/// the ink the most common colour inside that stands clearly apart from it. When nothing does (a
/// region of one colour, or ink too close to its background to read), the ink is black or white,
/// whichever contrasts more.
public struct CaptureTextColors: Equatable, Sendable {
  public let background: AnnotationRGBA
  public let ink: AnnotationRGBA

  public init(background: AnnotationRGBA, ink: AnnotationRGBA) {
    self.background = background
    self.ink = ink
  }

  /// White under black: what a paragraph gets when its region cannot be read.
  public static let fallback = Self(background: .white, ink: .black)

  /// The longest side the region is sampled at; larger regions are scaled down first.
  static let sampleSide = 96
  /// How deep the edge ring is, in sample pixels.
  static let edgeDepth = 2
  /// The least contrast (WCAG ratio) sampled ink keeps against its background.
  static let minimumContrast = 3.0
  /// The least share of the region the ink must cover to count.
  static let minimumInkShare = 0.01

  /// The colours of `region` of `image`, in the image's pixels with the origin at its top-left;
  /// nil when the region misses the image or the image cannot be read.
  public static func sample(_ image: CGImage, region: CGRect) -> Self? {
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let area = region.standardized.intersection(bounds).integral
    guard !area.isNull, area.width >= 1, area.height >= 1, let crop = image.cropping(to: area)
    else { return nil }
    let scale = min(1, Double(sampleSide) / Double(max(crop.width, crop.height)))
    let width = max(Int((Double(crop.width) * scale).rounded()), 1)
    let height = max(Int((Double(crop.height) * scale).rounded()), 1)
    guard let pixels = rgba(crop, width: width, height: height) else { return nil }
    return colors(pixels, width: width, height: height)
  }

  /// The colours of `pixels`, `width` × `height` sRGB RGBA bytes.
  static func colors(_ pixels: [UInt8], width: Int, height: Int) -> Self {
    var edge = Histogram()
    var all: [(bin: Int, color: (Double, Double, Double))] = []
    all.reserveCapacity(width * height)
    for y in 0..<height {
      for x in 0..<width {
        let offset = (y * width + x) * 4
        let alpha = Double(pixels[offset + 3]) / 255
        guard alpha > 0 else { continue }
        // Unpremultiply; screenshots are opaque, so this is almost always a no-op.
        let color = (
          Double(pixels[offset]) / 255 / alpha, Double(pixels[offset + 1]) / 255 / alpha,
          Double(pixels[offset + 2]) / 255 / alpha
        )
        let bin = Histogram.bin(color)
        all.append((bin, color))
        let depth = edgeDepth
        if x < depth || y < depth || x >= width - depth || y >= height - depth {
          edge.add(bin, color)
        }
      }
    }
    guard let background = edge.dominant() else { return .fallback }
    var ink = Histogram()
    for (bin, color) in all {
      let candidate = AnnotationRGBA(red: color.0, green: color.1, blue: color.2)
      if candidate.contrast(with: background) >= minimumContrast { ink.add(bin, color) }
    }
    let share = Double(ink.largestCount) / Double(max(all.count, 1))
    guard let sampled = ink.dominant(), share >= minimumInkShare else {
      return Self(background: background, ink: contrasting(background))
    }
    return Self(background: background, ink: sampled)
  }

  /// Black or white, whichever reads better on `background`.
  public static func contrasting(_ background: AnnotationRGBA) -> AnnotationRGBA {
    background.contrast(with: .black) >= background.contrast(with: .white) ? .black : .white
  }

  /// `image` drawn into `width` × `height` sRGB RGBA bytes, rows from the top.
  private static func rgba(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: space,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    return drawn ? pixels : nil
  }

  /// Colours counted in bins of 16 levels per channel, each bin keeping the sum of its colours, so
  /// the dominant bin's colour is the average of what fell into it.
  struct Histogram {
    private var counts: [Int: Int] = [:]
    private var sums: [Int: (Double, Double, Double)] = [:]

    static func bin(_ color: (Double, Double, Double)) -> Int {
      func level(_ value: Double) -> Int { min(Int(value * 16), 15) }
      return level(color.0) << 8 | level(color.1) << 4 | level(color.2)
    }

    mutating func add(_ bin: Int, _ color: (Double, Double, Double)) {
      counts[bin, default: 0] += 1
      let sum = sums[bin] ?? (0, 0, 0)
      sums[bin] = (sum.0 + color.0, sum.1 + color.1, sum.2 + color.2)
    }

    var largestCount: Int { counts.values.max() ?? 0 }

    /// The average colour of the fullest bin (the lowest bin among equals, so it is stable).
    func dominant() -> AnnotationRGBA? {
      guard let (bin, count) = counts.max(by: { ($0.value, -$0.key) < ($1.value, -$1.key) }),
        let sum = sums[bin]
      else { return nil }
      let total = Double(count)
      return AnnotationRGBA(red: sum.0 / total, green: sum.1 / total, blue: sum.2 / total)
    }
  }
}
