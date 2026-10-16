import AICore
import CoreGraphics

/// Every display frozen for one session, as one desktop (``CaptureDesktop``): their images and
/// the geometry that places them. Displays are added as they freeze, the cursor's first; the
/// desktop's extent is known before any of them, so desktop points never shift meanwhile.
final class FrozenDesktop {
  private(set) var geometry: CaptureDesktop
  /// In the order they froze.
  private(set) var displays: [FrozenDisplay] = []
  /// The last composed backdrop and the desktop rect it covers.
  private var composed: (area: CGRect, backdrop: CaptureBackdrop)?

  /// A desktop over `quartzBounds`, the union of every display the session will freeze.
  init(quartzBounds: CGRect) {
    geometry = CaptureDesktop(quartzBounds: quartzBounds)
  }

  func add(_ display: FrozenDisplay) {
    displays.removeAll { $0.displayID == display.displayID }
    displays.append(display)
    geometry.add(display.geometry)
    composed = nil
  }

  func display(_ id: CGDirectDisplayID) -> FrozenDisplay? {
    displays.first { $0.displayID == id }
  }

  /// The display's area of the desktop, in desktop points.
  func frame(of display: FrozenDisplay) -> CGRect { geometry.desktopRect(display.quartzFrame) }

  /// The pixels mosaics over `selection` (desktop points) sample. A selection on one display
  /// gets that display's own image. One spanning displays gets the displays it covers composed
  /// at the largest scale among them, which takes tens of megabytes, so it is built only then and
  /// kept while the selection covers the same displays.
  func backdrop(for selection: CGRect) -> CaptureBackdrop? {
    let covered = geometry.displays(overlapping: selection)
    guard covered.count > 1 else {
      let id = covered.first?.id ?? geometry.primary(for: selection)?.id
      guard let display = id.flatMap(display(_:)) ?? displays.first else { return nil }
      return CaptureBackdrop(
        image: display.image, scale: display.pixelScale, origin: frame(of: display).origin)
    }
    let area = covered.map(geometry.frame(of:)).reduce(CGRect.null) { $0.union($1) }
    if let composed, composed.area == area { return composed.backdrop }
    guard let stitch = geometry.stitch(area), let image = draw(stitch)?.makeImage() else {
      return nil
    }
    let backdrop = CaptureBackdrop(image: image, scale: stitch.scale, origin: area.origin)
    composed = (area, backdrop)
    return backdrop
  }

  /// A bitmap of `stitch`'s size holding its pieces, transparent where no display lies, in
  /// the colour space of the first display it takes from.
  func draw(_ stitch: CaptureDesktop.Stitch) -> CGContext? {
    let sources = stitch.pieces.compactMap { piece in
      display(piece.displayID).map { (piece, $0.image) }
    }
    guard let like = sources.first?.1,
      let context = CaptureExport.bitmap(width: stitch.width, height: stitch.height, like: like)
    else { return nil }
    let height = CGFloat(stitch.height)
    context.clear(CGRect(x: 0, y: 0, width: stitch.width, height: stitch.height))
    for (piece, image) in sources {
      guard let crop = image.cropping(to: piece.source) else { continue }
      let target = piece.destination
      // A coarser display scaled up to the stitch's scale needs interpolation; one at its own
      // scale is copied pixel for pixel.
      let exact = target.size == piece.source.size
      context.interpolationQuality = exact ? .none : .high
      // Bitmap contexts are y-up; destinations are top-left.
      context.draw(
        crop,
        in: CGRect(
          x: target.minX, y: height - target.maxY, width: target.width, height: target.height))
    }
    return context
  }
}
