import AppKit

/// The style bar's size slider, from smallest (left) to largest (right), like PixPin's. A drag
/// sends its action as the knob moves and once more at mouse-up only if the final value was not
/// yet sent, all with the same ``burst``, so the owner commits the whole drag as one undo step.
/// Scroll wheel events forward normalized deltas through ``onWheelDelta`` and settle via
/// ``onBurstEnd``.
final class AnnotationSizeSlider: NSSlider {
  /// The drag in progress; nil between drags.
  private(set) var burst: UUID?
  var onWheelDelta: ((Double, UUID) -> Bool)?
  var onBurstEnd: (() -> Void)?

  private let wheelBurst = CaptureWheelBurst()
  private var lastSentValue: Double?

  init() {
    super.init(frame: .zero)
    minValue = 0
    maxValue = 1
    isContinuous = true
    controlSize = .small
    refusesFirstResponder = true
    translatesAutoresizingMaskIntoConstraints = false
    widthAnchor.constraint(equalToConstant: 112).isActive = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var acceptsFirstResponder: Bool { false }

  override var isEnabled: Bool {
    didSet {
      if !isEnabled, oldValue { CaptureTooltipPresenter.shared.dismiss(for: self) }
    }
  }

  override var toolTip: String? {
    get { captureTooltip }
    set {
      super.toolTip = nil
      setCaptureTooltip(newValue)
    }
  }

  /// The overlay panel never becomes key, so the first click must work.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func sendAction(_ action: Selector?, to target: Any?) -> Bool {
    lastSentValue = doubleValue
    return super.sendAction(action, to: target)
  }

  /// AppKit runs the drag inside `super.mouseDown`, which returns once the button is up.
  override func mouseDown(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss(for: self)
    wheelBurst.reset()
    let initialValue = doubleValue
    lastSentValue = nil
    burst = UUID()
    super.mouseDown(with: event)
    let needsFinalSend =
      if let lastSentValue {
        abs(lastSentValue - doubleValue) > 1e-9
      } else {
        abs(doubleValue - initialValue) > 1e-9
      }
    if needsFinalSend {
      _ = sendAction(action, to: target)
    }
    burst = nil
    lastSentValue = nil
    onBurstEnd?()
  }

  /// Steplessly adjusts the slider on wheel/trackpad gestures when ``onWheelDelta`` handles it.
  override func scrollWheel(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss(for: self)
    guard isEnabled, let onWheelDelta else {
      nextResponder?.scrollWheel(with: event)
      return
    }
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return
    case .delta(let unit):
      let burst = wheelBurst.next(for: event) { [weak self] in self?.onBurstEnd?() }
      let before = doubleValue
      let next = min(maxValue, max(minValue, before + unit * (maxValue - minValue)))
      guard onWheelDelta(unit, burst) else {
        wheelBurst.reset()
        nextResponder?.scrollWheel(with: event)
        return
      }
      if abs(doubleValue - before) <= 1e-9, abs(next - doubleValue) > 1e-9 {
        doubleValue = next
      }
    }
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole.passive.cursor)
  }
}
