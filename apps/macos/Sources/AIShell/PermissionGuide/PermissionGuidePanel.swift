import AICore
import AppKit

/// The permission guide's window: a borderless, non-activating glass panel docked under System
/// Settings' window, so clicking or dragging in it keeps System Settings in front. It reads
/// "Drag Atd to the list above to allow Accessibility" over the app's ``PermissionGuideCard``,
/// with a close button. It shows only where ``place(under:)`` puts it, and never at a guess.
///
/// Docking (in AppKit screen points): the panel spans System Settings' content column, right of
/// its fixed sidebar, and hangs just below the window; where the screen has no room below, it
/// sits inside the window's bottom edge instead.
final class PermissionGuidePanel: NSObject {
  var onClose: (() -> Void)?

  private let window: NSPanel
  private let stack = NSStackView()
  private let message: NSTextField
  private let width: NSLayoutConstraint

  /// System Settings' sidebar, which the panel leaves uncovered.
  private static let sidebarWidth: CGFloat = 230
  private static let minimumWidth: CGFloat = 320
  private static let gap: CGFloat = 8
  private static let padding: CGFloat = 12

  init(pane: PermissionPane, appURL: URL, appName: String) {
    let strings = ShellStrings.shared.catalog
    window = NSPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.level = .floating
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.becomesKeyOnlyIfNeeded = true
    window.animationBehavior = .none
    window.collectionBehavior = [.fullScreenAuxiliary, .transient, .ignoresCycle]

    message = NSTextField(wrappingLabelWithString: "")
    message.attributedStringValue = Self.message(
      strings(.permissionGuideTitle, appName, strings(pane.nameKey)),
      bold: [appName, strings(pane.nameKey)])
    // The sentence takes the header's free width and wraps within it.
    message.setContentHuggingPriority(.defaultLow, for: .horizontal)

    let arrow = NSImageView(
      image: NSImage(systemSymbolName: "arrow.up", accessibilityDescription: nil) ?? NSImage())
    arrow.symbolConfiguration = .init(pointSize: 13, weight: .semibold)
    arrow.contentTintColor = .controlAccentColor
    let close = NSButton(
      image: NSImage(
        systemSymbolName: "xmark.circle.fill",
        accessibilityDescription: strings(.permissionGuideClose)) ?? NSImage(),
      target: nil, action: nil)
    close.isBordered = false
    close.symbolConfiguration = .init(pointSize: 15, weight: .regular)
    close.contentTintColor = .tertiaryLabelColor
    close.toolTip = strings(.permissionGuideClose)

    let header = NSStackView(views: [arrow, message, close])
    header.orientation = .horizontal
    header.alignment = .firstBaseline
    header.spacing = 6
    header.distribution = .fill
    for icon in [arrow, close] as [NSView] {
      icon.setContentHuggingPriority(.required, for: .horizontal)
      icon.setContentCompressionResistancePriority(.required, for: .horizontal)
    }
    let card = PermissionGuideCard(
      appURL: appURL, name: appName, dragHint: strings(.permissionGuideDrag))

    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    let inset = Self.padding
    stack.edgeInsets = NSEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    stack.setViews([header, card], in: .top)
    for row in [header, card] {
      row.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -inset * 2).isActive = true
    }
    let glass = GlassBackground.material()
    glass.cornerRadius = 18
    glass.contentView = stack
    window.contentView = glass
    width = stack.widthAnchor.constraint(equalToConstant: Self.minimumWidth)
    width.isActive = true
    super.init()

    close.target = self
    close.action = #selector(closeClicked)
  }

  /// Docks the panel to System Settings' window frame, or hides it for nil.
  func place(under settings: CGRect?) {
    guard let settings, let screen = Self.screen(for: settings) else {
      window.orderOut(nil)
      return
    }
    let visible = screen.visibleFrame
    let contentMinX = settings.minX + Self.sidebarWidth
    let width = min(max(settings.maxX - contentMinX, Self.minimumWidth), visible.width)
    let height = fittingHeight(width: width)
    var origin = CGPoint(x: settings.maxX - width, y: settings.minY - Self.gap - height)
    if origin.y < visible.minY { origin.y = settings.minY + Self.padding }
    origin.x = min(max(origin.x, visible.minX), visible.maxX - width)
    window.setFrame(
      CGRect(origin: origin, size: CGSize(width: width, height: height)), display: true)
    if !window.isVisible { window.orderFrontRegardless() }
  }

  func close() {
    window.orderOut(nil)
    onClose = nil
  }

  @objc private func closeClicked() { onClose?() }

  private func fittingHeight(width: CGFloat) -> CGFloat {
    // The arrow, the close button and the header's spacing take the rest of the row.
    message.preferredMaxLayoutWidth = width - Self.padding * 2 - 13 - 17 - 12
    self.width.constant = width
    return ceil(stack.fittingSize.height)
  }

  private static func screen(for frame: CGRect) -> NSScreen? {
    NSScreen.screens.max {
      $0.frame.intersection(frame).width * $0.frame.intersection(frame).height
        < $1.frame.intersection(frame).width * $1.frame.intersection(frame).height
    }
  }

  /// The localized sentence with the app's and the permission's names in bold.
  private static func message(_ text: String, bold names: [String]) -> NSAttributedString {
    let size: CGFloat = 13
    let result = NSMutableAttributedString(
      string: text,
      attributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.labelColor])
    for name in names {
      let range = (text as NSString).range(of: name)
      if range.location != NSNotFound {
        result.addAttribute(
          .font, value: NSFont.systemFont(ofSize: size, weight: .semibold), range: range)
      }
    }
    return result
  }
}
