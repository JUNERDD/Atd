import AppKit

/// Small system application artwork for mentions, resolved through the same preferred install
/// as computer access. Reading an icon never opens the application or registers a target.
@MainActor
enum InstalledApplicationIcon {
  static func png(bundleId: String) -> Data? {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId),
      Bundle(url: url)?.bundleIdentifier == bundleId,
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap)
    else { return nil }
    let bounds = NSRect(x: 0, y: 0, width: 64, height: 64)
    bitmap.size = bounds.size
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.cgContext.clear(bounds)
    icon.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]),
      // Base64 expands each three bytes to four; the bridge accepts at most 65,536 characters.
      png.count <= 49_152
    else { return nil }
    return png
  }
}
