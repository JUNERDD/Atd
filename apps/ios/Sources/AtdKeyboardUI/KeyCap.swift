import UIKit

/// One key as drawn: a rounded cap with a label or a symbol. `KeysView` handles the touches, so
/// a press anywhere near a key reaches it.
final class KeyCap: UIView {
  let spec: KeySpec
  private let label = UILabel()
  private let image = UIImageView()

  var isPressed = false {
    didSet { if oldValue != isPressed { updateFill() } }
  }
  /// The return key when it acts on the host (发送, 前往).
  var isAccent = false {
    didSet { if oldValue != isAccent { updateFill() } }
  }
  var isEnabled = true {
    didSet { if oldValue != isEnabled { updateFill() } }
  }

  init(spec: KeySpec) {
    self.spec = spec
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    layer.cornerRadius = KeyboardMetrics.keyCorner
    layer.cornerCurve = .continuous
    label.textAlignment = .center
    label.adjustsFontSizeToFitWidth = true
    label.minimumScaleFactor = 0.6
    label.isAccessibilityElement = false
    image.contentMode = .center
    addSubview(label)
    addSubview(image)
    isAccessibilityElement = true
    accessibilityTraits = .keyboardKey
    updateFill()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// Shows a title, or with `symbol` an SF Symbol, and names the key for VoiceOver.
  func show(title: String? = nil, symbol: String? = nil, font: UIFont, accessibility: String) {
    label.text = symbol == nil ? title : nil
    label.font = font
    let configuration = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
    image.image = symbol.flatMap { UIImage(systemName: $0, withConfiguration: configuration) }
    accessibilityLabel = accessibility
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    label.frame = bounds.insetBy(dx: 3, dy: 0)
    image.frame = bounds
  }

  private func updateFill() {
    let resting = spec.isFunction ? KeyboardColors.functionKey : KeyboardColors.letterKey
    let pressed = spec.isFunction ? KeyboardColors.letterKey : KeyboardColors.functionKey
    let accent = isAccent && isEnabled
    backgroundColor = accent ? .tintColor : isPressed ? pressed : resting
    let ink: UIColor = accent ? .white : isEnabled ? .label : .tertiaryLabel
    label.textColor = ink
    image.tintColor = ink
    accessibilityTraits = isEnabled ? .keyboardKey : [.keyboardKey, .notEnabled]
  }
}
