import AICore
import AppKit

/// Color chip / swatch well in ``CaptureColorPickerPopover`` for active, palette, and recent slots.
@MainActor
final class CaptureColorSwatchWell: NSButton {
  var color: AnnotationRGBA? { didSet { needsDisplay = true } }
  var isChosen = false {
    didSet { if isChosen != oldValue { needsDisplay = true } }
  }
  override var isEnabled: Bool {
    didSet {
      if isEnabled != oldValue {
        window?.invalidateCursorRects(for: self)
        if !isEnabled { CaptureTooltipPresenter.shared.dismiss(for: self) }
      }
    }
  }
  private let interactive: Bool

  init(interactive: Bool) {
    self.interactive = interactive
    super.init(frame: .zero)
    isBordered = false
    title = ""
    isEnabled = interactive
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { interactive }

  override var toolTip: String? {
    get { captureTooltip }
    set {
      super.toolTip = nil
      setCaptureTooltip(interactive ? newValue : nil)
    }
  }

  override func mouseDown(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss(for: self)
    super.mouseDown(with: event)
  }
  override func hitTest(_ point: NSPoint) -> NSView? {
    interactive && isEnabled ? super.hitTest(point) : nil
  }

  override func resetCursorRects() {
    if interactive { addCursorRect(bounds, cursor: PointerRole(button: self).cursor) }
  }

  override func draw(_ dirtyRect: NSRect) {
    let well = bounds.insetBy(dx: 1, dy: 1)
    let path = NSBezierPath(roundedRect: well, xRadius: 5, yRadius: 5)
    if let color {
      NSGraphicsContext.saveGraphicsState()
      path.addClip()
      if color.alpha < 0.999 { AnnotationIcons.drawCheckerboard(in: well, cell: 4) }
      color.nsColor.setFill()
      well.fill()
      NSGraphicsContext.restoreGraphicsState()
      let rim = NSBezierPath(
        roundedRect: well.insetBy(dx: 0.5, dy: 0.5), xRadius: 4.5, yRadius: 4.5)
      rim.lineWidth = 1
      NSColor.labelColor.withAlphaComponent(0.18).setStroke()
      rim.stroke()
    } else {
      NSColor.labelColor.withAlphaComponent(0.05).setFill()
      path.fill()
      let rim = NSBezierPath(
        roundedRect: well.insetBy(dx: 0.5, dy: 0.5), xRadius: 4.5, yRadius: 4.5)
      rim.lineWidth = 1
      rim.setLineDash([2.5, 2.5], count: 2, phase: 0)
      NSColor.labelColor.withAlphaComponent(0.18).setStroke()
      rim.stroke()
    }
    if isChosen {
      let focus = NSBezierPath(
        roundedRect: bounds.insetBy(dx: 0.75, dy: 0.75), xRadius: 6, yRadius: 6)
      focus.lineWidth = 1.5
      NSColor.controlAccentColor.setStroke()
      focus.stroke()
    }
  }
}
