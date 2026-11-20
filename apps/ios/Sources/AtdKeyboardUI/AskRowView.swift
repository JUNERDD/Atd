import AtdKeyboardCore
import AtdPinyin
import UIKit

/// The ✦ line above the strip: what was typed, the pinyin still being composed (underlined, as in
/// the field), or a placeholder that says what the line is for.
final class AskRowView: UIView {
  var onClose: () -> Void = {}
  private let field = UIView()
  private let icon = UIImageView(image: UIImage(systemName: "sparkle"))
  private let text = UILabel()
  private let close = UIButton(type: .system)

  override init(frame: CGRect) {
    super.init(frame: frame)
    field.backgroundColor = KeyboardColors.chip
    field.layer.cornerRadius = 17
    field.layer.cornerCurve = .continuous
    icon.tintColor = .label
    icon.contentMode = .center
    text.font = .systemFont(ofSize: 16)
    text.lineBreakMode = .byTruncatingHead
    close.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
    close.tintColor = .secondaryLabel
    close.accessibilityLabel = KeyboardText.string("ask.close")
    close.addAction(UIAction { [weak self] _ in self?.onClose() }, for: .primaryActionTriggered)
    addSubview(field)
    for view in [icon, text, close] { field.addSubview(view) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func render(_ ask: AskStrip) {
    guard ask.text.isEmpty, ask.letters.isEmpty else {
      let shown = NSMutableAttributedString(
        string: ask.text, attributes: [.foregroundColor: UIColor.label])
      shown.append(
        NSAttributedString(
          string: ask.letters,
          attributes: [
            .foregroundColor: UIColor.secondaryLabel,
            .underlineStyle: NSUnderlineStyle.single.rawValue,
          ]))
      text.attributedText = shown
      return
    }
    let placeholder: String.LocalizationValue =
      switch ask.purpose {
      case .refine: "ask.refine"
      case .rewrite: "ask.rewrite"
      case .write: "ask.write"
      }
    text.attributedText = NSAttributedString(
      string: KeyboardText.string(placeholder),
      attributes: [.foregroundColor: UIColor.tertiaryLabel])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    field.frame = bounds.insetBy(dx: 6, dy: 4)
    let height = field.bounds.height
    icon.frame = CGRect(x: 4, y: 0, width: 32, height: height)
    close.frame = CGRect(x: field.bounds.width - 40, y: 0, width: 40, height: height)
    text.frame = CGRect(x: 36, y: 0, width: field.bounds.width - 76, height: height)
  }
}

/// Every candidate, in place of the keys, for a reading the strip has no room for.
final class CandidatePanel: UIView {
  var onPick: (PinyinCandidate) -> Void = { _ in }
  private let scroll = UIScrollView()
  private var buttons: [UIButton] = []
  private var candidates: [PinyinCandidate] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    scroll.alwaysBounceVertical = true
    addSubview(scroll)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func render(_ candidates: [PinyinCandidate]) {
    guard candidates != self.candidates else { return }
    self.candidates = candidates
    for button in buttons { button.removeFromSuperview() }
    buttons = candidates.map { candidate in
      var configuration = UIButton.Configuration.plain()
      configuration.baseForegroundColor = .label
      configuration.attributedTitle = AttributedString(
        candidate.text, attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 19)]))
      let button = UIButton(
        configuration: configuration,
        primaryAction: UIAction { [weak self] _ in self?.onPick(candidate) })
      scroll.addSubview(button)
      return button
    }
    scroll.contentOffset = .zero
    setNeedsLayout()
  }

  /// Lays the candidates out in rows, each as wide as it needs and at least 44 pt.
  override func layoutSubviews() {
    super.layoutSubviews()
    scroll.frame = bounds
    let width = bounds.width - 12
    var origin = CGPoint(x: 6, y: 4)
    for button in buttons {
      let size = button.sizeThatFits(CGSize(width: width, height: 44))
      let itemWidth = min(max(size.width, 44), width)
      if origin.x + itemWidth > width + 6, origin.x > 6 {
        origin = CGPoint(x: 6, y: origin.y + 44)
      }
      button.frame = CGRect(x: origin.x, y: origin.y, width: itemWidth, height: 44)
      origin.x += itemWidth
    }
    scroll.contentSize = CGSize(width: bounds.width, height: origin.y + 48)
  }
}
