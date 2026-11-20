import AtdModel
import UIKit

/// The strip above the keys: the ✦ mark, what the state offers in a row that scrolls sideways,
/// and one button at the end. A panel's title takes its place while the panel is open.
final class StripView: UIView {
  var onTap: (StripTap) -> Void = { _ in }
  var onOptions: (String) -> Void = { _ in }
  var onEnd: (StripEnd) -> Void = { _ in }
  var onMark: () -> Void = {}
  var onBack: () -> Void = {}

  private let mark = UIButton(type: .system)
  private let scroll = UIScrollView()
  private let row = UIStackView()
  private let end = UIButton(type: .system)
  private let back = UIButton(type: .system)
  private let title = UILabel()
  private var content: StripContent?

  override init(frame: CGRect) {
    super.init(frame: frame)
    mark.setImage(UIImage(systemName: "sparkle"), for: .normal)
    mark.tintColor = .label
    mark.addAction(UIAction { [weak self] _ in self?.onMark() }, for: .primaryActionTriggered)
    end.tintColor = .label
    end.addAction(
      UIAction { [weak self] _ in
        guard let self, let end = content?.end else { return }
        onEnd(end)
      }, for: .primaryActionTriggered)
    back.tintColor = .label
    back.addAction(UIAction { [weak self] _ in self?.onBack() }, for: .primaryActionTriggered)
    title.font = .systemFont(ofSize: 16, weight: .semibold)
    scroll.showsHorizontalScrollIndicator = false
    scroll.alwaysBounceHorizontal = true
    row.axis = .horizontal
    row.spacing = 6
    row.alignment = .center
    scroll.addSubview(row)
    for view in [scroll, mark, end, back, title] { addSubview(view) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func render(_ content: StripContent) {
    guard content != self.content else { return }
    let rebuilds = content.items != self.content?.items
    self.content = content
    let isHeader = content.header != nil
    title.text = content.header?.title
    let backSymbol = content.header?.isDone == true ? "checkmark" : "chevron.backward"
    back.setImage(UIImage(systemName: backSymbol), for: .normal)
    back.accessibilityLabel = KeyboardText.string(
      content.header?.isDone == true ? "panel.done" : "strip.back")
    back.isHidden = !isHeader
    title.isHidden = !isHeader
    scroll.isHidden = isHeader
    mark.isHidden = isHeader || content.mark == nil
    mark.accessibilityLabel = KeyboardText.string(
      content.mark == .refine ? "strip.askRefine" : "strip.ask")
    renderEnd(isHeader ? .none : content.end)
    if rebuilds {
      for view in row.arrangedSubviews { view.removeFromSuperview() }
      for item in content.items { row.addArrangedSubview(view(for: item)) }
      scroll.contentOffset = .zero
    }
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let side = KeyboardMetrics.stripButton
    let height = bounds.height
    mark.frame = CGRect(x: 0, y: 0, width: side, height: height)
    back.frame = mark.frame
    end.frame = CGRect(x: bounds.width - side, y: 0, width: side, height: height)
    title.frame = CGRect(x: side, y: 0, width: bounds.width - 2 * side, height: height)
    let leading = mark.isHidden ? 6 : side
    let trailing = end.isHidden ? 6 : side
    scroll.frame = CGRect(
      x: leading, y: 0, width: bounds.width - leading - trailing, height: height)
    let size = row.systemLayoutSizeFitting(
      CGSize(width: UIView.layoutFittingExpandedSize.width, height: height))
    row.frame = CGRect(x: 0, y: 0, width: size.width, height: height)
    scroll.contentSize = row.frame.size
  }

  private func renderEnd(_ role: StripEnd) {
    let symbol: String?
    let label: String
    var enabled = true
    switch role {
    case .none:
      (symbol, label) = (nil, "")
    case .clipboard:
      (symbol, label) = ("list.clipboard", KeyboardText.string("strip.clipboard"))
    case .candidates(let open):
      (symbol, label) = (
        open ? "chevron.up" : "chevron.down",
        KeyboardText.string(open ? "strip.fewerCandidates" : "strip.moreCandidates")
      )
    case .regenerate(let isEnabled):
      (symbol, label) = ("arrow.clockwise", KeyboardText.string("strip.regenerate"))
      enabled = isEnabled
    }
    end.isEnabled = enabled
    end.setImage(symbol.flatMap { UIImage(systemName: $0) }, for: .normal)
    end.accessibilityLabel = label
    end.isHidden = symbol == nil
  }

  // MARK: Items

  private func view(for item: StripItem) -> UIView {
    switch item {
    case .chip(let chip):
      return chipButton(chip)
    case .candidate(let text, let emphasized, let tap):
      var configuration = UIButton.Configuration.plain()
      configuration.baseForegroundColor = .label
      configuration.contentInsets = NSDirectionalEdgeInsets(
        top: 8, leading: 9, bottom: 8, trailing: 9)
      configuration.attributedTitle = AttributedString(
        text,
        attributes: AttributeContainer([
          .font: UIFont.systemFont(ofSize: 18, weight: emphasized ? .medium : .regular)
        ]))
      return button(configuration, tap: tap)
    case .line(let text, let tap):
      var configuration = UIButton.Configuration.plain()
      configuration.baseForegroundColor = .secondaryLabel
      configuration.attributedTitle = AttributedString(
        text, attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 14)]))
      let view = button(configuration, tap: tap)
      if tap == nil { view.isUserInteractionEnabled = false }
      return view
    case .tag(let text):
      let label = UILabel()
      label.text = text
      label.font = .systemFont(ofSize: 12, weight: .medium)
      label.textColor = .secondaryLabel
      return label
    }
  }

  private func chipButton(_ chip: StripChip) -> UIButton {
    var configuration = UIButton.Configuration.filled()
    configuration.cornerStyle = .capsule
    configuration.baseBackgroundColor =
      chip.isSelected ? KeyboardColors.selectedChip : KeyboardColors.chip
    configuration.baseForegroundColor = .label
    configuration.contentInsets = NSDirectionalEdgeInsets(
      top: 7, leading: 12, bottom: 7, trailing: 12)
    configuration.imagePadding = 5
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
      pointSize: 13, weight: .medium)
    if let symbol = chip.symbol {
      let image = UIImage(systemName: symbol)
      configuration.image =
        chip.tint.map { image?.withTintColor($0.color, renderingMode: .alwaysOriginal) } ?? image
    }
    configuration.showsActivityIndicator = chip.isBusy
    let weight: UIFont.Weight = chip.isLead || chip.isSelected ? .semibold : .regular
    configuration.attributedTitle = AttributedString(
      chip.title,
      attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 15, weight: weight)]))
    let button = button(configuration, tap: chip.tap)
    if chip.isSelected { button.accessibilityTraits.insert(.selected) }
    if let id = chip.options {
      let hold = OptionsHold(target: self, action: #selector(held(_:)))
      hold.commandID = id
      button.addGestureRecognizer(hold)
    }
    return button
  }

  private func button(_ configuration: UIButton.Configuration, tap: StripTap?) -> UIButton {
    let button = UIButton(configuration: configuration)
    if let tap {
      button.addAction(UIAction { [weak self] _ in self?.onTap(tap) }, for: .primaryActionTriggered)
    }
    return button
  }

  @objc private func held(_ recognizer: OptionsHold) {
    guard recognizer.state == .began else { return }
    onOptions(recognizer.commandID)
  }
}

/// Holding a command chip opens that command's options.
private final class OptionsHold: UILongPressGestureRecognizer {
  var commandID = ""
}

extension CommandTint {
  /// The system hue it names.
  var color: UIColor {
    switch self {
    case .red: .systemRed
    case .orange: .systemOrange
    case .yellow: .systemYellow
    case .green: .systemGreen
    case .mint: .systemMint
    case .teal: .systemTeal
    case .cyan: .systemCyan
    case .blue: .systemBlue
    case .indigo: .systemIndigo
    case .purple: .systemPurple
    case .pink: .systemPink
    case .brown: .systemBrown
    case .gray: .systemGray
    }
  }
}
