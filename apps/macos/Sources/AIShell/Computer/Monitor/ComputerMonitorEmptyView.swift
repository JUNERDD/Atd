import AICore
import AppKit

/// What the window shows while the task has no sources: a centered symbol, title and detail in
/// the system label colors directly on the window's glass.
final class ComputerMonitorEmptyView: NSView {
  private let stack = NSStackView()
  private let symbol = NSImageView()
  private let title = NSTextField(wrappingLabelWithString: "")
  private let detail = NSTextField(wrappingLabelWithString: "")

  override init(frame: NSRect) {
    super.init(frame: frame)
    symbol.image = NSImage(systemSymbolName: "display", accessibilityDescription: nil)
    symbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 40, weight: .regular)
    symbol.contentTintColor = .secondaryLabelColor
    title.font = .systemFont(ofSize: 15, weight: .semibold)
    title.textColor = .labelColor
    detail.font = .systemFont(ofSize: 13)
    // Primary, not secondary: secondary label falls under 4.5:1 on the light surface fill, and
    // the title's weight already carries the hierarchy.
    detail.textColor = .labelColor
    for label in [title, detail] { label.alignment = .center }
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 6
    stack.addArrangedSubview(symbol)
    stack.setCustomSpacing(12, after: symbol)
    stack.addArrangedSubview(title)
    stack.addArrangedSubview(detail)
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -48),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
    ])
    localize()
  }

  required init?(coder: NSCoder) { nil }

  /// The labels wrap at the width the stack may take, which they learn before it is laid out.
  override func layout() {
    let width = max(0, min(360, bounds.width - 48))
    for label in [title, detail] { label.preferredMaxLayoutWidth = width }
    super.layout()
  }

  func localize() {
    title.stringValue = ShellStrings.shared.text(.computerMonitorEmptyTitle)
    detail.stringValue = ShellStrings.shared.text(.computerMonitorEmptyDetail)
  }
}
