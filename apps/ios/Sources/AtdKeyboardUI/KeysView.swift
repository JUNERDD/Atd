import UIKit

/// What the keys show besides their characters.
struct KeyStates: Equatable {
  /// Space reads 用这个 and delete becomes 还原 while a result is on show.
  var controlsPreview = false
  var returnTitle = ""
  var returnEnabled = true
  var returnAccent = false
}

/// The four rows of keys. A press goes to the nearest key, so the gaps never swallow it, and a
/// second finger commits the key the first is on, as on the system keyboard. Delete fires on
/// touch-down and repeats while held; every other key acts when it is let go.
final class KeysView: UIView {
  enum Shift {
    case off
    /// The next letter is a capital.
    case once
    case locked
  }

  var onKey: (KeyAction) -> Void = { _ in }
  var states = KeyStates() {
    didSet { if oldValue != states { relabel() } }
  }
  private(set) var keyLayer: KeyLayer = .letters
  private var shift = Shift.off
  private var lastShiftTap = Date.distantPast
  private var rows: [[KeyCap]] = []
  private var globe: UIButton?
  private weak var globeTarget: UIInputViewController?
  private var pressed: [ObjectIdentifier: KeyCap] = [:]
  private var repeating: Task<Void, Never>?

  /// Lays out a layer; `globeTarget` handles the globe key, which is drawn only when it is set.
  func configure(layer: KeyLayer, globeTarget: UIInputViewController?) {
    keyLayer = layer
    self.globeTarget = globeTarget
    for cap in rows.flatMap(\.self) { cap.removeFromSuperview() }
    globe?.removeFromSuperview()
    globe = nil
    rows = KeyLayout.rows(layer, globe: globeTarget != nil).map { row in
      row.map { spec in
        let cap = KeyCap(spec: spec)
        addSubview(cap)
        return cap
      }
    }
    if let globeTarget { addGlobe(target: globeTarget) }
    relabel()
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let insets = KeyboardMetrics.keysInsets
    let gap = KeyboardMetrics.columnGap
    let columns = CGFloat(KeyLayout.columns)
    let column = (bounds.width - insets.left - insets.right - (columns - 1) * gap) / columns
    for (index, row) in rows.enumerated() {
      let y = insets.top + CGFloat(index) * (KeyboardMetrics.keyHeight + KeyboardMetrics.rowGap)
      var start = 0
      for cap in row {
        start += cap.spec.offset
        let span = CGFloat(cap.spec.span)
        var frame = CGRect(
          x: insets.left + CGFloat(start) * (column + gap), y: y,
          width: span * column + (span - 1) * gap, height: KeyboardMetrics.keyHeight)
        frame.origin.x += cap.spec.leadingInset
        frame.size.width -= cap.spec.leadingInset + cap.spec.trailingInset
        cap.frame = frame
        if cap.spec.action == .globe { globe?.frame = frame }
        start += cap.spec.span
      }
    }
  }

  // MARK: Touches

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      // A new finger commits what the others were on.
      for (other, cap) in pressed {
        pressed[other] = nil
        release(cap, committing: true)
      }
      guard let cap = cap(at: touch.location(in: self)), cap.spec.action != .globe else { continue }
      pressed[ObjectIdentifier(touch)] = cap
      cap.isPressed = true
      UIDevice.current.playInputClick()
      if cap.spec.action == .delete { startRepeating() }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      let id = ObjectIdentifier(touch)
      guard let current = pressed[id], current.spec.action != .delete,
        let under = cap(at: touch.location(in: self)), under !== current,
        under.spec.action != .delete, under.spec.action != .globe
      else { continue }
      current.isPressed = false
      under.isPressed = true
      pressed[id] = under
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      guard let cap = pressed.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
      release(cap, committing: true)
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      guard let cap = pressed.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
      release(cap, committing: false)
    }
  }

  private func release(_ cap: KeyCap, committing: Bool) {
    cap.isPressed = false
    if cap.spec.action == .delete {
      repeating?.cancel()
      repeating = nil
      return
    }
    guard committing, cap.isEnabled else { return }
    commit(cap.spec.action)
  }

  private func commit(_ action: KeyAction) {
    switch action {
    case .character(let character):
      let typed = shift == .off ? character : character.uppercased()
      if shift == .once {
        shift = .off
        relabel()
      }
      onKey(.character(typed))
    case .shift:
      let now = Date.now
      shift = now.timeIntervalSince(lastShiftTap) < 0.35 ? .locked : shift == .off ? .once : .off
      lastShiftTap = now
      relabel()
    case .layer(let layer):
      shift = .off
      configure(layer: layer, globeTarget: globeTarget)
    default:
      onKey(action)
    }
  }

  /// Delete fires now, then again and again while it is held.
  private func startRepeating() {
    onKey(.delete)
    repeating?.cancel()
    repeating = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(450))
      while !Task.isCancelled {
        self?.onKey(.delete)
        try? await Task.sleep(for: .milliseconds(80))
      }
    }
  }

  /// The key nearest to `point`: the row under it, then the key closest across.
  private func cap(at point: CGPoint) -> KeyCap? {
    let pitch = KeyboardMetrics.keyHeight + KeyboardMetrics.rowGap
    let offset = point.y - KeyboardMetrics.keysInsets.top + KeyboardMetrics.rowGap / 2
    let index = min(max(Int(offset / pitch), 0), rows.count - 1)
    guard rows.indices.contains(index) else { return nil }
    return rows[index].min { distance($0.frame, point.x) < distance($1.frame, point.x) }
  }

  private func distance(_ frame: CGRect, _ x: CGFloat) -> CGFloat {
    x < frame.minX ? frame.minX - x : x > frame.maxX ? x - frame.maxX : 0
  }

  // MARK: Labels

  private func addGlobe(target: UIInputViewController) {
    var configuration = UIButton.Configuration.filled()
    configuration.image = UIImage(systemName: "globe")
    configuration.baseBackgroundColor = KeyboardColors.functionKey
    configuration.baseForegroundColor = .label
    configuration.background.cornerRadius = KeyboardMetrics.keyCorner
    let button = UIButton(configuration: configuration)
    button.accessibilityLabel = KeyboardText.string("key.globe")
    button.addTarget(
      target, action: #selector(UIInputViewController.handleInputModeList(from:with:)),
      for: .allTouchEvents)
    addSubview(button)
    globe = button
  }

  private func relabel() {
    for cap in rows.flatMap(\.self) { label(cap) }
  }

  private func label(_ cap: KeyCap) {
    let function = UIFont.systemFont(ofSize: 16)
    switch cap.spec.action {
    case .character(let character):
      let shown = keyLayer == .letters && shift != .off ? character.uppercased() : character
      cap.show(title: shown, font: .systemFont(ofSize: 23), accessibility: shown)
    case .shift:
      let symbol = shift == .locked ? "capslock.fill" : shift == .once ? "shift.fill" : "shift"
      let name = KeyboardText.string(shift == .locked ? "key.capsLock" : "key.shift")
      cap.show(symbol: symbol, font: function, accessibility: name)
      cap.accessibilityTraits = shift == .off ? .keyboardKey : [.keyboardKey, .selected]
    case .delete:
      let revert = states.controlsPreview
      cap.show(
        symbol: revert ? "arrow.uturn.backward" : "delete.left", font: function,
        accessibility: KeyboardText.string(revert ? "key.revert" : "key.delete"))
    case .layer(let layer):
      let title = KeyboardText.string(
        layer == .letters ? "key.letters" : layer == .numbers ? "key.numbers" : "key.symbols")
      cap.show(title: title, font: function, accessibility: title)
    case .space:
      let use = states.controlsPreview
      let title = KeyboardText.string(use ? "key.use" : "key.space")
      cap.show(
        title: title, font: .systemFont(ofSize: 16, weight: use ? .semibold : .regular),
        accessibility: title)
    case .enter:
      cap.show(title: states.returnTitle, font: function, accessibility: states.returnTitle)
      cap.isEnabled = states.returnEnabled
      cap.isAccent = states.returnAccent
    case .globe:
      break
    }
  }
}
