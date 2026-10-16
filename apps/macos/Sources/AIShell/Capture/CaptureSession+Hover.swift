import AICore
import AppKit

/// The detected areas under the pointer (decision D8) and how every overlay shows the area or
/// selection of the moment. Areas are desktop points: a window spanning displays is offered
/// whole, and each overlay draws its part.
extension CaptureSession {
  /// Asks for the areas under the latest pointer position unless a request is in flight; the
  /// answer then asks again if the pointer moved meanwhile.
  func requestHover() {
    guard detection != nil, !hoverInFlight, let pointer, case .idle = phase else { return }
    hoverInFlight = true
    let quartz = desktop.geometry.quartzPoint(pointer.point)
    let targeting = targeting
    Task {
      let areas = await targeting.targets(at: quartz)
      hoverInFlight = false
      guard !isFinished else { return }
      apply(areas, for: pointer)
      if let latest = self.pointer,
        latest.overlay !== pointer.overlay || latest.point != pointer.point
      {
        requestHover()
      }
    }
  }

  private func apply(_ areas: [CGRect], for asked: (overlay: CaptureOverlayView, point: CGPoint)) {
    guard case .idle = phase, let current = pointer, current.overlay === asked.overlay else {
      return
    }
    let geometry = desktop.geometry
    // The window ends the targeting's answer; windows only keeps just that.
    let offered = onlyWindows ? Array(areas.suffix(1)) : areas
    var candidates: [CGRect] = []
    for area in offered.compactMap({ Self.cut(geometry.desktopRect($0), to: geometry.bounds) }) + [
      asked.overlay.bounds
    ] where candidates.last.map({ !Self.nearlyEqual($0, area) }) ?? true {
      candidates.append(area)
    }
    // A stale answer still counts while its smallest area holds the pointer: a slow app then
    // lags behind the pointer instead of never being offered.
    guard current.point == asked.point || candidates[0].contains(current.point) else { return }
    if candidates != chain || chainOverlay !== asked.overlay {
      chain = candidates
      chainOverlay = asked.overlay
      chainIndex = 0
    }
    renderIdle()
  }

  /// The area a click on `overlay` commits: the offered candidate, or its whole display.
  func offeredArea(on overlay: CaptureOverlayView) -> CGRect {
    guard chainOverlay === overlay, !chain.isEmpty else { return overlay.bounds }
    return chain[min(chainIndex, chain.count - 1)]
  }

  /// The detected area a click at `point` on `overlay` commits as `selection`, as a ``Pick``;
  /// nil for the display, which ends every chain and is no element.
  func pickedElement(at point: CGPoint, on overlay: CaptureOverlayView, selection: CGRect) -> Pick?
  {
    guard chainOverlay === overlay, chainIndex < chain.count - 1 else { return nil }
    let geometry = desktop.geometry
    return Pick(
      point: geometry.quartzPoint(point), frame: geometry.quartzRect(chain[chainIndex]),
      selection: selection)
  }

  /// The detected areas under a desktop point, for the editor's one-click shapes: the
  /// targeting's Quartz answer in desktop points, cut to the desktop, smallest first.
  func elementTargets(at point: CGPoint) async -> [CGRect] {
    guard detection != nil, !isFinished else { return [] }
    let geometry = desktop.geometry
    return geometry.targets(await targeting.targets(at: geometry.quartzPoint(point)))
  }

  /// Forgets the offered candidates, so the next answer is applied afresh (`W`).
  func resetChain() {
    chain = []
    chainOverlay = nil
    chainIndex = 0
  }

  /// Scroll and Tab: a larger (positive) or smaller candidate under the pointer.
  func walkChain(_ step: Int) {
    guard case .idle = phase, !chain.isEmpty else { return }
    chainIndex = min(max(chainIndex + step, 0), chain.count - 1)
    renderIdle()
  }

  // MARK: Showing areas

  /// Idle: the offered area on every display it reaches, the loupe on the pointer's.
  func renderIdle() {
    show(pointer.map { offeredArea(on: $0.overlay) }, handles: false)
    showLoupe(at: pointer?.point)
  }

  /// `area` on every overlay (each draws its part), with its size label on the overlay holding
  /// most of it; nil dims every display.
  func show(_ area: CGRect?, handles: Bool) {
    let labelled = area.flatMap(primaryOverlay(for:))
    let label = area.map(sizeLabel(for:))
    for overlay in overlays {
      overlay.show(area: area, handles: handles, label: overlay === labelled ? label : nil)
    }
  }

  /// The loupe at a desktop point on the display under it, none on the others.
  func showLoupe(at point: CGPoint?) {
    for overlay in overlays {
      overlay.showLoupe(at: point.flatMap { overlay.bounds.contains($0) ? $0 : nil })
    }
  }

  /// The overlay of the display holding most of `rect`.
  func primaryOverlay(for rect: CGRect) -> CaptureOverlayView? {
    guard let primary = desktop.geometry.primary(for: rect) else { return nil }
    return overlays.first { $0.display.displayID == primary.id }
  }

  /// "W × H" in points, plus the exported pixels when they differ (``ScreenshotRules``).
  private func sizeLabel(for rect: CGRect) -> String {
    let stitch = desktop.geometry.stitch(rect)
    return ScreenshotRules.sizeLabel(
      points: rect.size, pixelWidth: stitch?.width, pixelHeight: stitch?.height)
  }

  private static func cut(_ rect: CGRect, to bounds: CGRect) -> CGRect? {
    let cut = rect.intersection(bounds)
    return cut.isNull || cut.width <= 0 || cut.height <= 0 ? nil : cut
  }

  private static func nearlyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    abs(lhs.minX - rhs.minX) < 1 && abs(lhs.minY - rhs.minY) < 1 && abs(lhs.maxX - rhs.maxX) < 1
      && abs(lhs.maxY - rhs.maxY) < 1
  }
}
