import AICore
import AppKit

/// Per-overlay corner-radius popover controller and chrome synchronization for screenshot selection.
@MainActor
final class CaptureOverlayCornerControl {
  private let popover = CaptureCornerRadiusPopover()
  var radius: CGFloat = 0
  var allowsCornerBadge: (() -> Bool)?
  var onCornerRadiusChanged: ((CGFloat) -> Void)?
  var onCornerPopoverClose: (() -> Void)?
  var isPopoverShown: Bool { popover.isShown }
  var shouldCoalesceCornerRadiusSave: Bool { !isDiscreteChipChange }
  private var isDiscreteChipChange = false
  private var pendingSaveFlush: (() -> Void)?
  private var isDefaultFlushScheduled = false

  func attach(to overlay: CaptureOverlayView) {
    popover.maxRadius = CaptureCornerRadiusMemory.maxRadius
    popover.onChange = { [weak self] value, burst in
      guard let self else { return }
      self.isDiscreteChipChange = burst == nil
      defer { self.isDiscreteChipChange = false }
      self.radius = value
      self.onCornerRadiusChanged?(value)
    }
    popover.onBurstEnd = { [weak self] in
      self?.flushPendingCornerRadiusSave()
    }
    popover.onClose = { [weak self, weak overlay] in
      self?.flushPendingCornerRadiusSave()
      self?.onCornerPopoverClose?()
      overlay?.refreshCursor()
    }
    overlay.chrome.onCornerBadgeClick = { [weak self, weak overlay] _ in
      guard let overlay else { return }
      self?.togglePopover(on: overlay)
    }
  }

  func syncBadge(on overlay: CaptureOverlayView) {
    let allowed = allowsCornerBadge?() ?? false
    overlay.chrome.showsCornerBadge = allowed
    overlay.chrome.selectionCornerRadius = allowed ? radius : 0
    if (!allowed || overlay.chrome.cornerBadgeFrame == nil) && popover.isShown {
      popover.dismissPopover()
    }
  }

  func updateRadius(_ value: CGFloat, on overlay: CaptureOverlayView) {
    radius = value
    if popover.isShown && !popover.isDraggingSlider {
      popover.currentRadius = value
    }
    let allowed = allowsCornerBadge?() ?? false
    overlay.chrome.showsCornerBadge = allowed
    overlay.chrome.selectionCornerRadius = allowed ? value : 0
  }

  func dismissPopover() {
    popover.dismissPopover()
  }

  func scheduleCornerRadiusSave(_ flush: @escaping () -> Void) {
    pendingSaveFlush = flush
    guard !popover.isWheelBurstActive, !isDefaultFlushScheduled else { return }
    isDefaultFlushScheduled = true
    RunLoop.main.perform(inModes: [.default]) { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.isDefaultFlushScheduled = false
        self.flushPendingCornerRadiusSave()
      }
    }
  }

  func flushPendingCornerRadiusSave() {
    guard let flush = pendingSaveFlush else { return }
    pendingSaveFlush = nil
    flush()
  }

  func clearPendingCornerRadiusSave() {
    pendingSaveFlush = nil
  }

  private func togglePopover(on overlay: CaptureOverlayView) {
    if popover.isShown {
      popover.dismissPopover()
      return
    }
    guard allowsCornerBadge?() == true, let frame = overlay.chrome.cornerBadgeFrame else {
      return
    }
    popover.currentRadius = radius
    popover.show(relativeTo: frame, of: overlay.chrome, preferredEdge: .minY)
  }
}

extension CaptureOverlayView {
  var hasOpenCornerPopover: Bool { cornerControl.isPopoverShown }

  var onCornerPopoverClose: (() -> Void)? {
    get { cornerControl.onCornerPopoverClose }
    set { cornerControl.onCornerPopoverClose = newValue }
  }

  var selectionCornerRadius: CGFloat {
    get { chrome.selectionCornerRadius }
    set { cornerControl.updateRadius(newValue, on: self) }
  }

  func configureCornerRadius(
    radius: CGFloat,
    allowed: @escaping () -> Bool,
    onChange: @escaping (CGFloat) -> Void
  ) {
    cornerControl.allowsCornerBadge = allowed
    cornerControl.onCornerRadiusChanged = onChange
    cornerControl.updateRadius(radius, on: self)
  }

  func dismissCornerPopover() {
    cornerControl.dismissPopover()
  }
}
