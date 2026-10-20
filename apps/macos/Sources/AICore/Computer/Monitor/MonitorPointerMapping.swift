import CoreGraphics
import Foundation

/// How one ScreenCaptureKit frame holds its window: the attachments the monitor's stream delivers
/// with every frame, and the size of the buffer they describe.
public struct MonitorFrameGeometry: Equatable, Sendable {
  /// `SCStreamFrameInfo.contentRect`: the window's rect in the buffer, in surface points with a
  /// top-left origin. Times ``scaleFactor`` it is buffer pixels.
  public let contentRect: CGRect
  /// `SCStreamFrameInfo.contentScale`: how far ScreenCaptureKit shrank the window to fit the
  /// buffer. 1 keeps its native pixels; the monitor's buffer is capped, so large windows sit
  /// below it.
  public let contentScale: CGFloat
  /// `SCStreamFrameInfo.scaleFactor`: the backing scale of the window's display.
  public let scaleFactor: CGFloat
  /// The buffer in pixels.
  public let bufferSize: CGSize

  public init(
    contentRect: CGRect, contentScale: CGFloat, scaleFactor: CGFloat, bufferSize: CGSize
  ) {
    self.contentRect = contentRect
    self.contentScale = contentScale
    self.scaleFactor = scaleFactor
    self.bufferSize = bufferSize
  }

  /// Buffer pixels per point of the window. `contentScale` is already part of the surface points
  /// of ``contentRect``, so it enters here and nowhere else.
  public var pixelsPerPoint: CGFloat { contentScale * scaleFactor }

  /// The window's rect in the buffer, in pixels.
  public var contentPixels: CGRect {
    CGRect(
      x: contentRect.minX * scaleFactor, y: contentRect.minY * scaleFactor,
      width: contentRect.width * scaleFactor, height: contentRect.height * scaleFactor)
  }

  /// The part of the window inside the buffer: the pixels a picture shows.
  public var visiblePixels: CGRect {
    contentPixels.intersection(CGRect(origin: .zero, size: bufferSize))
  }

  /// The size of the window in points, as this frame shows it.
  public var windowSize: CGSize {
    CGSize(
      width: contentPixels.width / pixelsPerPoint, height: contentPixels.height / pixelsPerPoint)
  }

  /// Whether the attachments describe a window that can be placed.
  public var isValid: Bool {
    contentScale.isFinite && contentScale > 0 && scaleFactor.isFinite && scaleFactor > 0
      && pixelsPerPoint.isFinite && pixelsPerPoint > 0 && contentRect.isUsable
      && contentPixels.isUsable && visiblePixels.isUsable
  }
}

/// An observed target pinned to the window it was observed in. Every point in it is a Quartz
/// global point (origin at the primary display's top-left, y down), the space of the host's
/// progress geometry and of `CGWindowList` bounds.
public struct MonitorPointerSnapshot: Equatable, Sendable {
  /// The target, as the host observed it; not cut to the window.
  public let rect: CGRect
  /// The source window's frame when `rect` was observed.
  public let windowFrame: CGRect
  /// When the observation stops being trusted.
  public let validUntil: Date

  public init(rect: CGRect, windowFrame: CGRect, validUntil: Date) {
    self.rect = rect
    self.windowFrame = windowFrame
    self.validUntil = validUntil
  }
}

/// Where the agent pointer goes in a monitor picture (plan §4.4). The pointer is drawn from the
/// host's progress geometry, which is in screen points, onto a live stream of the window, so
/// the mark is trusted only while the window still is where the geometry says and the frame being
/// shown holds that same window. Anything else clears it, because a mark on a picture of a window
/// that moved or resized would point at the wrong control.
///
/// Pure arithmetic on what the caller has measured: no clock, window server or stream is read
/// here.
public enum MonitorPointerMapping {
  /// How far (points) the window's live frame may differ from the snapshot's before the mark
  /// goes. The two come from the same window list, so a real move is never this small.
  public static let frameTolerance: CGFloat = 1

  /// Why a mark is not shown.
  public enum Cleared: Equatable, Sendable {
    /// The observation expired.
    case stale
    /// The target or its window frame is not a rect that can be placed.
    case invalidTarget
    /// The window is gone from the window list.
    case windowGone
    /// The window's origin is no longer the snapshot's.
    case windowMoved
    /// The window's size is no longer the snapshot's.
    case windowResized
    /// No frame to place the mark on yet (the stream has none, or is unavailable).
    case noFrame
    /// The frame's attachments do not describe a window.
    case invalidFrame
    /// The frame shows a window of another size than the snapshot's: a frame from before or
    /// after a resize, or a crop of the window.
    case frameMismatch
    /// The target misses the part of the window the frame holds.
    case outsideWindow
    /// The picture has no area to draw in.
    case noRoom
  }

  public enum Outcome: Equatable, Sendable {
    /// The target in the picture's own space: origin top-left, y down, in points.
    case target(CGRect)
    case cleared(Cleared)
  }

  /// Whether `snapshot` can still be trusted by what the window does now, and if not why: it has
  /// expired, or the window is gone, moved or resized since it was taken. Needs no frame, so the
  /// feed can ask it on its own.
  public static func staleness(
    of snapshot: MonitorPointerSnapshot, liveWindowFrame: CGRect?, now: Date
  ) -> Cleared? {
    guard snapshot.rect.isUsable, snapshot.windowFrame.isUsable else { return .invalidTarget }
    guard snapshot.validUntil > now else { return .stale }
    guard let live = liveWindowFrame, live.isUsable else { return .windowGone }
    return changed(snapshot.windowFrame, to: live)
  }

  /// Rules 1 to 5 of plan §4.4 for one frame, in order:
  ///
  /// 1. The target minus the window's live frame is a point of the window, cut to the window.
  /// 2. The frame's attachments turn it into buffer pixels: the window's origin in the buffer
  ///    plus its points times the pixels per point.
  /// 3. The picture shows those pixels fitted inside it, centered and never cropped, as
  ///    `NativeVideoView` lays them out; the target follows.
  /// 4. A window that is not where the snapshot put it, or a frame of another size, clears.
  /// 5. So does an invalid position or an expired observation.
  ///
  /// - Parameters:
  ///   - liveWindowFrame: the window's frame now; nil when the window list has none.
  ///   - frame: the geometry of the newest frame; nil while there is none.
  ///   - picture: the size the frame is fitted in.
  public static func map(
    _ snapshot: MonitorPointerSnapshot, liveWindowFrame: CGRect?, frame: MonitorFrameGeometry?,
    picture: CGSize, now: Date
  ) -> Outcome {
    if let cleared = staleness(of: snapshot, liveWindowFrame: liveWindowFrame, now: now) {
      return .cleared(cleared)
    }
    guard let live = liveWindowFrame else { return .cleared(.windowGone) }
    guard let frame else { return .cleared(.noFrame) }
    guard frame.isValid else { return .cleared(.invalidFrame) }
    // The frame's pixels were rounded inward, which can take up to two of them off a window.
    let slack = max(frameTolerance, 2 / frame.pixelsPerPoint)
    guard abs(frame.windowSize.width - live.width) <= slack,
      abs(frame.windowSize.height - live.height) <= slack
    else { return .cleared(.frameMismatch) }
    guard picture.width.isFinite, picture.height.isFinite, picture.width > 0, picture.height > 0
    else { return .cleared(.noRoom) }

    let local = snapshot.rect.offsetBy(dx: -live.minX, dy: -live.minY)
      .intersection(CGRect(origin: .zero, size: live.size))
    guard local.isUsable else { return .cleared(.outsideWindow) }

    let content = frame.contentPixels
    let visible = frame.visiblePixels
    let scale = frame.pixelsPerPoint
    let pixels = CGRect(
      x: content.minX + local.minX * scale, y: content.minY + local.minY * scale,
      width: local.width * scale, height: local.height * scale
    ).intersection(visible)
    guard pixels.isUsable else { return .cleared(.outsideWindow) }

    let fit = min(picture.width / visible.width, picture.height / visible.height)
    let originX = (picture.width - visible.width * fit) / 2
    let originY = (picture.height - visible.height * fit) / 2
    return .target(
      CGRect(
        x: originX + (pixels.minX - visible.minX) * fit,
        y: originY + (pixels.minY - visible.minY) * fit,
        width: pixels.width * fit, height: pixels.height * fit))
  }

  private static func changed(_ snapshot: CGRect, to live: CGRect) -> Cleared? {
    let tolerance = frameTolerance
    if abs(live.width - snapshot.width) > tolerance
      || abs(live.height - snapshot.height) > tolerance
    {
      return .windowResized
    }
    if abs(live.minX - snapshot.minX) > tolerance || abs(live.minY - snapshot.minY) > tolerance {
      return .windowMoved
    }
    return nil
  }
}

extension CGRect {
  /// Finite, with an area.
  fileprivate var isUsable: Bool {
    guard !isNull, !isInfinite else { return false }
    return [minX, minY, width, height].allSatisfy(\.isFinite) && width > 0 && height > 0
  }
}
