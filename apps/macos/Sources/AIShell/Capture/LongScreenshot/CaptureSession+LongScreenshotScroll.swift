import AICore
import AppKit

/// Scroll routing during the long screenshot's live phase: real scroll events reach the live
/// window directly beneath the mouse-ignoring backdrop, so pass-through observation records user
/// scrolls over the scrollable region while overlay scroll events over the interactive bars are
/// consumed without triggering selection chain walks.
extension CaptureSession {
  /// Points per line of a wheel without precise deltas, which reports lines.
  static let longScreenshotWheelLine: CGFloat = 16

  /// Consumes scroll-wheel events delivered directly to the overlay's interactive bars during the
  /// live phase so they do not fall through to selection chain walking.
  func overlayScrolledInLongScreenshot(_ event: NSEvent) -> Bool {
    if case .longScreenshot = phase { true } else { false }
  }

  /// Observes scroll-wheel events passing through to the app beneath and notifies the engine when
  /// the pointer lies over the scrollable region.
  func userScrolled(_ event: NSEvent) {
    guard case .longScreenshot(let rect) = phase, let live = longScreenshot.live,
      !live.finishing, let owner = primaryOverlay(for: rect), let window = owner.window
    else { return }
    let point = owner.convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
    guard scrollableRegion(for: rect, in: live, on: owner).contains(point) else { return }
    live.capture.directUserScrolled(event, deltaY: scrollDeltaY(of: event))
  }

  /// Resolves an unobstructed Quartz point inside the scrollable band for auto-scroll, avoiding
  /// floating chrome, the bottom bar, and the size label.
  func scrollTargetLocation(in live: CaptureLongScreenshot.Live) -> CGPoint? {
    guard case .longScreenshot(let rect) = phase else { return nil }
    let band = scrollBand(for: rect, in: live)
    let owner = primaryOverlay(for: rect)
    let obstacles =
      live.chrome.frames + [owner?.barFrame, owner?.sizeLabelFrame].compactMap(\.self)
    return desktop.geometry.quartzPoint(
      LongScreenshotChromeLayout.scrollPoint(in: band, avoiding: obstacles))
  }

  private func scrollableRegion(
    for rect: CGRect, in live: CaptureLongScreenshot.Live, on owner: CaptureOverlayView
  ) -> CGRect {
    if let area = longScreenshot.answer(for: rect)?.area {
      return desktop.geometry.desktopRect(area.frame).union(live.selection)
    }
    let quartz = desktop.geometry.quartzRect(live.selection)
    let center = CGPoint(x: quartz.midX, y: quartz.midY)
    if let windowFrame = longScreenshot.snapshot.windowFrame(at: center) {
      return desktop.geometry.desktopRect(windowFrame).union(live.selection)
    }
    return owner.bounds
  }

  private func scrollBand(for rect: CGRect, in live: CaptureLongScreenshot.Live) -> CGRect {
    guard let area = longScreenshot.answer(for: rect)?.area else { return live.selection }
    let intersection = live.selection.intersection(desktop.geometry.desktopRect(area.frame))
    return intersection.isNull || intersection.isEmpty ? live.selection : intersection
  }

  private func scrollDeltaY(of event: NSEvent) -> CGFloat {
    event.hasPreciseScrollingDeltas
      ? event.scrollingDeltaY : event.scrollingDeltaY * Self.longScreenshotWheelLine
  }
}
