import AIWidgetModel
import AppKit

/// Draws a launcher app's `icon.svg` into a bitmap for its tile.
///
/// The SVG is untrusted: an agent wrote it. This is the only place it is parsed, inside the
/// sandboxed widget extension, which reads no user files but the widget files and has no network
/// access; the shell only copies the bytes and never decodes them. The data must pass the
/// launcher's byte checks first (``WidgetLauncherIcon/accepts(_:)``: bounded size, SVG text, no
/// entity declarations). AppKit decodes SVG data itself (`NSImage(data:)`). Drawing it into a
/// bitmap of the size the tile needs means the widget's archive carries pixels rather than the
/// vector, and keeps all its images far below the total image area WidgetKit agrees to archive.
enum LauncherIconRasterizer {
  /// A `pixels`-square sRGB bitmap of the icon, aspect fit and centered, with its transparent
  /// areas kept; nil when the data fails the byte checks or AppKit cannot decode it.
  static func image(svg data: Data, pixels: Int) -> CGImage? {
    guard pixels > 0, WidgetLauncherIcon.accepts(data), let image = NSImage(data: data),
      image.size.width > 0, image.size.height > 0,
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let side = CGFloat(pixels)
    let scale = min(side / image.size.width, side / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let rect = CGRect(
      x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width,
      height: size.height)
    let previous = NSGraphicsContext.current
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    image.draw(in: rect)
    NSGraphicsContext.current = previous
    return context.makeImage()
  }
}
