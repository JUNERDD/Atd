import Foundation

/// Every display of one capture as a single desktop, so a selection can span displays.
///
/// Desktop points are Quartz points minus ``origin``, the top-left of the union of the displays'
/// bounds: the desktop starts at zero and grows right and down. With one display the desktop is
/// that display and its points are the display's view points (``CaptureCoordinates``). Areas of
/// the union that no display covers (displays of different sizes, or set diagonally) belong to
/// the desktop too; they hold no pixels and export transparent.
public struct CaptureDesktop: Equatable, Sendable {
  /// A frozen display: its Quartz bounds and the size of its image.
  public struct Display: Equatable, Sendable {
    public let id: UInt32
    public let quartzFrame: CGRect
    public let pixelWidth: Int
    public let pixelHeight: Int

    public init(id: UInt32, quartzFrame: CGRect, pixelWidth: Int, pixelHeight: Int) {
      self.id = id
      self.quartzFrame = quartzFrame
      self.pixelWidth = pixelWidth
      self.pixelHeight = pixelHeight
    }

    /// Image pixels per point; mixed setups differ per display.
    public var scale: CGFloat {
      CaptureCoordinates.pixelScale(pixelWidth: pixelWidth, pointWidth: quartzFrame.width)
    }
  }

  /// One display's share of an export: which of its pixels land where in the exported image.
  public struct Piece: Equatable, Sendable {
    public let displayID: UInt32
    /// Pixels of the display's image, origin top-left.
    public let source: CGRect
    /// Pixels of the exported image, origin top-left.
    public let destination: CGRect
  }

  /// How the pixels under a selection become one image.
  public struct Stitch: Equatable, Sendable {
    /// Pixels per point of the exported image.
    public let scale: CGFloat
    public let width: Int
    public let height: Int
    public let pieces: [Piece]
    /// Maps desktop points to the exported image's pixels (origin top-left, y down), so what is
    /// drawn at a desktop point lands on the pixel the pieces took from there.
    public let transform: CGAffineTransform
  }

  /// The Quartz point at the desktop's top-left.
  public let origin: CGPoint
  public let size: CGSize
  /// The displays frozen so far, in the order they were added.
  public private(set) var displays: [Display] = []

  /// An empty desktop over `quartzBounds`, the union of every display's Quartz bounds.
  public init(quartzBounds: CGRect) {
    origin = quartzBounds.origin
    size = quartzBounds.size
  }

  /// Adds a frozen display; one already added under the same id is replaced.
  public mutating func add(_ display: Display) {
    displays.removeAll { $0.id == display.id }
    displays.append(display)
  }

  public func display(_ id: UInt32) -> Display? { displays.first { $0.id == id } }

  public var bounds: CGRect { CGRect(origin: .zero, size: size) }

  /// The largest pixels per point of any display.
  public var maxScale: CGFloat { displays.map(\.scale).max() ?? 1 }

  // MARK: Coordinates

  public func frame(of display: Display) -> CGRect { desktopRect(display.quartzFrame) }

  public func desktopPoint(_ quartz: CGPoint) -> CGPoint {
    CGPoint(x: quartz.x - origin.x, y: quartz.y - origin.y)
  }

  public func quartzPoint(_ desktop: CGPoint) -> CGPoint {
    CGPoint(x: desktop.x + origin.x, y: desktop.y + origin.y)
  }

  public func desktopRect(_ quartz: CGRect) -> CGRect {
    quartz.offsetBy(dx: -origin.x, dy: -origin.y)
  }

  public func quartzRect(_ desktop: CGRect) -> CGRect {
    desktop.offsetBy(dx: origin.x, dy: origin.y)
  }

  /// Detected areas (Quartz) in desktop points, cut to the desktop, those that miss it dropped,
  /// smallest first (ties keep their order).
  public func targets(_ quartz: [CGRect]) -> [CGRect] {
    CaptureCoordinates.viewTargets(quartz, display: quartzRect(bounds))
  }

  // MARK: Displays

  /// The selection geometry over every display added so far.
  public var selectionModel: SelectionModel {
    SelectionModel(
      bounds: bounds,
      displays: displays.map { SelectionModel.Display(frame: frame(of: $0), scale: $0.scale) })
  }

  /// The display under a desktop point; nil in a gap between displays.
  public func display(containing point: CGPoint) -> Display? {
    displays.first { frame(of: $0).contains(point) }
  }

  /// The displays `rect` covers some area of, in the order they were added.
  public func displays(overlapping rect: CGRect) -> [Display] {
    displays.filter { Self.area(frame(of: $0).intersection(rect)) > 0 }
  }

  /// The display holding the largest part of `rect` (the first on a tie); for an empty rect,
  /// the display containing it. Nil when `rect` is on no display.
  public func primary(for rect: CGRect) -> Display? {
    let shares = displays.map { ($0, Self.area(frame(of: $0).intersection(rect))) }
    if let best = shares.max(by: { $0.1 < $1.1 }), best.1 > 0 {
      return shares.first { $0.1 == best.1 }?.0
    }
    return display(containing: CGPoint(x: rect.midX, y: rect.midY))
  }

  // MARK: Export

  /// How the pixels under `selection` (desktop points) become one image, or nil when it holds
  /// no pixel. A selection inside one display crops that display's pixels exactly as a
  /// single-display capture does. One spanning displays is drawn at the largest scale among
  /// them, so no display loses detail (a coarser one is scaled up), and a gap stays empty.
  public func stitch(_ selection: CGRect) -> Stitch? {
    let touched = displays(overlapping: selection)
    if touched.count == 1, let display = touched.first, frame(of: display).contains(selection) {
      return crop(selection, on: display)
    }
    guard let scale = touched.map(\.scale).max(),
      let output = Self.pixels(selection, scale: scale)
    else { return nil }
    let canvas = CGRect(origin: .zero, size: output.size)
    let pieces = touched.compactMap { display -> Piece? in
      let frame = frame(of: display)
      let shared = selection.intersection(frame)
      guard let placed = Self.pixels(shared, scale: scale),
        let taken = Self.pixels(
          shared.offsetBy(dx: -frame.minX, dy: -frame.minY), scale: display.scale)
      else { return nil }
      let destination = placed.offsetBy(dx: -output.minX, dy: -output.minY).intersection(canvas)
      let source = taken.intersection(
        CGRect(x: 0, y: 0, width: display.pixelWidth, height: display.pixelHeight))
      guard !destination.isNull, !source.isNull, !destination.isEmpty, !source.isEmpty else {
        return nil
      }
      return Piece(displayID: display.id, source: source, destination: destination)
    }
    return Stitch(
      scale: scale, width: Int(output.width), height: Int(output.height), pieces: pieces,
      transform: CGAffineTransform(translationX: -output.minX, y: -output.minY)
        .scaledBy(x: scale, y: scale))
  }

  /// A selection inside `display`: its own pixels, edges rounded as ``CaptureCoordinates``
  /// rounds them for a single display.
  private func crop(_ selection: CGRect, on display: Display) -> Stitch? {
    let frame = frame(of: display)
    let local = selection.offsetBy(dx: -frame.minX, dy: -frame.minY)
    guard
      let pixels = CaptureCoordinates.pixelRect(
        local, scale: display.scale, width: display.pixelWidth, height: display.pixelHeight)
    else { return nil }
    let transform = CGAffineTransform(translationX: -frame.minX, y: -frame.minY)
      .concatenating(CaptureCoordinates.cropTransform(selection: local, scale: display.scale))
    return Stitch(
      scale: display.scale, width: Int(pixels.width), height: Int(pixels.height),
      pieces: [
        Piece(
          displayID: display.id, source: pixels,
          destination: CGRect(origin: .zero, size: pixels.size))
      ], transform: transform)
  }

  /// `rect` in pixels at `scale`, each edge rounded to the nearest pixel; nil when no whole
  /// pixel is left.
  private static func pixels(_ rect: CGRect, scale: CGFloat) -> CGRect? {
    guard !rect.isNull else { return nil }
    let minX = (rect.minX * scale).rounded()
    let minY = (rect.minY * scale).rounded()
    let maxX = (rect.maxX * scale).rounded()
    let maxY = (rect.maxY * scale).rounded()
    guard maxX - minX >= 1, maxY - minY >= 1 else { return nil }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  private static func area(_ rect: CGRect) -> CGFloat {
    rect.isNull ? 0 : rect.width * rect.height
  }
}
