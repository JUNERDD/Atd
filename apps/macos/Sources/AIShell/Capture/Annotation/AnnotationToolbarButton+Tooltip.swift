import AppKit

/// Routes ``AnnotationToolbarButton`` tooltips through ``CaptureTooltipPresenter`` above capture
/// panels while suppressing AppKit's native tooltip window (`super.toolTip = nil`).
extension AnnotationToolbarButton {
  func applyCaptureTooltip(_ text: String?, edge: CaptureTooltipEdge? = nil) {
    guard let trimmed = CaptureTooltipPresenter.clean(text) else {
      captureTooltipStorage = nil
      CaptureTooltipPresenter.shared.dismiss(for: self)
      tooltipLifecycleObserver?.removeFromSuperview()
      return
    }
    captureTooltipStorage = (trimmed, edge)
    if tooltipLifecycleObserver == nil {
      addSubview(AnnotationToolbarTooltipObserver(frame: .zero))
    }
    CaptureTooltipPresenter.shared.updateTooltip(for: self, text: trimmed, edge: edge)
  }

  func tooltipHoverChanged() {
    guard isHovered, let storage = captureTooltipStorage else {
      CaptureTooltipPresenter.shared.hoverExited(anchor: self)
      return
    }
    CaptureTooltipPresenter.shared.hoverEntered(
      anchor: self, text: storage.text, edge: storage.edge)
  }

  func tooltipDismiss() {
    CaptureTooltipPresenter.shared.dismiss(for: self)
  }

  func syncPointerHover() {
    guard followsPointer else { return }
    guard let window, window.isVisible, !isHiddenOrHasHiddenAncestor, !bounds.isEmpty else {
      isHovered = false
      return
    }
    isHovered = bounds.contains(convert(window.mouseLocationOutsideOfEventStream, from: nil))
  }

  private var tooltipLifecycleObserver: AnnotationToolbarTooltipObserver? {
    subviews.first { $0 is AnnotationToolbarTooltipObserver }
      as? AnnotationToolbarTooltipObserver
  }
}

private final class AnnotationToolbarTooltipObserver: NSView {
  override func isAccessibilityElement() -> Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidHide() {
    super.viewDidHide()
    clearHost()
  }

  override func viewDidUnhide() {
    super.viewDidUnhide()
    (superview as? AnnotationToolbarButton)?.syncPointerHover()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      clearHost()
    } else {
      (superview as? AnnotationToolbarButton)?.syncPointerHover()
    }
  }

  private func clearHost() {
    guard let button = superview as? AnnotationToolbarButton else { return }
    button.isHovered = false
    button.tooltipDismiss()
  }
}
