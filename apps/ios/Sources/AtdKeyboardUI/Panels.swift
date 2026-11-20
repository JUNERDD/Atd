import AtdModel
import UIKit

/// The clipboard and phrases, in place of the keys: 粘贴 for what is on the clipboard, what was
/// read from it while the keyboard was open, and the saved phrases. Phrases work offline.
final class ClipboardPanel: UIView {
  var onPaste: () -> Void = {}
  var onInsert: (String) -> Void = { _ in }
  private let list = PanelList()
  private var shown: (Bool, [String], [Phrase])?

  override init(frame: CGRect) {
    super.init(frame: frame)
    addSubview(list)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func render(canPaste: Bool, history: [String], phrases: [Phrase]) {
    if let shown, shown == (canPaste, history, phrases) { return }
    shown = (canPaste, history, phrases)
    list.clear()
    if canPaste {
      list.addRow(title: KeyboardText.string("panel.paste"), symbol: "doc.on.clipboard") {
        [weak self] in self?.onPaste()
      }
    }
    if !history.isEmpty {
      list.addSection(KeyboardText.string("panel.recent"))
      for text in history {
        list.addRow(title: text) { [weak self] in self?.onInsert(text) }
      }
    }
    if !phrases.isEmpty {
      list.addSection(KeyboardText.string("panel.phrases"))
      for phrase in phrases {
        list.addRow(title: phrase.title, detail: phrase.text) { [weak self] in
          self?.onInsert(phrase.text)
        }
      }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    list.frame = bounds
  }
}

/// A command's options, in place of the keys, held from its chip: each choice is remembered in
/// the library (the 指令 tab shows it too), and 运行 runs the command with them.
final class OptionsPanel: UIView {
  var onChoose: (_ key: String, _ value: String) -> Void = { _, _ in }
  var onRun: () -> Void = {}
  private let list = PanelList()
  private var command: Command?

  override init(frame: CGRect) {
    super.init(frame: frame)
    addSubview(list)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func render(_ command: Command) {
    guard command != self.command else { return }
    self.command = command
    list.clear()
    for option in command.options {
      list.addSection(option.label)
      list.addChoices(option.choices, selected: option.value) { [weak self] value in
        self?.onChoose(option.key, value)
      }
    }
    list.addRun(KeyboardText.string("panel.run")) { [weak self] in self?.onRun() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    list.frame = bounds
  }
}

/// A vertical list for the panels: section titles, rows that act on a tap, choices and a
/// primary button, scrolling when it is taller than the keys it replaces.
private final class PanelList: UIScrollView {
  private let stack = UIStackView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    alwaysBounceVertical = true
    stack.axis = .vertical
    stack.spacing = 2
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(
      top: 4, leading: 12, bottom: 8, trailing: 12)
    addSubview(stack)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = stack.systemLayoutSizeFitting(
      CGSize(width: bounds.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    stack.frame = CGRect(x: 0, y: 0, width: bounds.width, height: size.height)
    contentSize = stack.frame.size
  }

  func clear() {
    for view in stack.arrangedSubviews { view.removeFromSuperview() }
    contentOffset = .zero
    setNeedsLayout()
  }

  func addSection(_ title: String) {
    let label = UILabel()
    label.text = title
    label.font = .systemFont(ofSize: 13, weight: .medium)
    label.textColor = .secondaryLabel
    label.accessibilityTraits = .header
    stack.addArrangedSubview(label)
    stack.setCustomSpacing(6, after: label)
  }

  func addRow(
    title: String, detail: String? = nil, symbol: String? = nil, action: @escaping () -> Void
  ) {
    var configuration = UIButton.Configuration.plain()
    configuration.baseForegroundColor = .label
    configuration.contentInsets = NSDirectionalEdgeInsets(
      top: 10, leading: 0, bottom: 10, trailing: 0)
    configuration.titleLineBreakMode = .byTruncatingTail
    configuration.subtitleLineBreakMode = .byTruncatingTail
    configuration.attributedTitle = AttributedString(
      title, attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 16)]))
    if let detail {
      configuration.attributedSubtitle = AttributedString(
        detail,
        attributes: AttributeContainer([
          .font: UIFont.systemFont(ofSize: 13), .foregroundColor: UIColor.secondaryLabel,
        ]))
    }
    configuration.image = symbol.flatMap { UIImage(systemName: $0) }
    configuration.imagePadding = 8
    let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
    button.contentHorizontalAlignment = .leading
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    stack.addArrangedSubview(button)
  }

  func addChoices(_ choices: [String], selected: String, action: @escaping (String) -> Void) {
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = 6
    row.distribution = .fillEqually
    for choice in choices {
      var configuration = UIButton.Configuration.filled()
      configuration.cornerStyle = .capsule
      configuration.title = choice
      let isOn = choice == selected
      configuration.baseBackgroundColor = isOn ? KeyboardColors.selectedChip : KeyboardColors.chip
      configuration.baseForegroundColor = .label
      let button = UIButton(
        configuration: configuration, primaryAction: UIAction { _ in action(choice) })
      if isOn { button.accessibilityTraits.insert(.selected) }
      button.heightAnchor.constraint(equalToConstant: 44).isActive = true
      row.addArrangedSubview(button)
    }
    stack.addArrangedSubview(row)
    stack.setCustomSpacing(12, after: row)
  }

  func addRun(_ title: String, action: @escaping () -> Void) {
    var configuration = UIButton.Configuration.filled()
    configuration.cornerStyle = .capsule
    configuration.title = title
    let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
    button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    stack.addArrangedSubview(button)
  }
}
