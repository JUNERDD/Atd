import AICore
import AppKit

/// What a picture shows instead of frames (any ``PreviewReason``): a centered content-unavailable
/// layout of a symbol (or a spinner while starting), a title, an optional one-line detail and an
/// optional action, in the window's appearance and its semantic label colors, which stay legible
/// on the picture's translucent backing and follow Increase Contrast. Narrow pictures wrap the
/// title onto a second line; short ones drop the detail first, then the symbol.
///
/// The view itself never hides: its children do, so a change between reasons, or to and from
/// none, crossfades on its layer instead of cutting.
final class ComputerMonitorStatusView: NSView {
  private let spinner = NSProgressIndicator()
  private let symbol = NSImageView()
  private let title = NSTextField(wrappingLabelWithString: "")
  private let detail = NSTextField(labelWithString: "")
  private let action = NSButton()
  private var reason: PreviewReason?
  private var animating = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    symbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 28, weight: .regular)
    title.font = .systemFont(ofSize: 13, weight: .semibold)
    title.textColor = .labelColor
    title.alignment = .center
    title.maximumNumberOfLines = 2
    title.lineBreakMode = .byTruncatingTail
    detail.font = .systemFont(ofSize: 11)
    detail.alignment = .center
    detail.lineBreakMode = .byTruncatingTail
    action.bezelStyle = .push
    action.controlSize = .small
    action.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
    action.target = self
    action.action = #selector(actionPressed)
    for view in [spinner, symbol, title, detail, action] as [NSView] { addSubview(view) }
    localize()
  }

  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { true }

  /// Shows `reason`, crossfading from what was shown. `animating` runs the starting spinner,
  /// which only a presenting picture needs. Every new frame repeats the call, so an unchanged
  /// status returns at once.
  func show(_ reason: PreviewReason?, animating: Bool) {
    guard reason != self.reason || animating != self.animating else { return }
    if reason != self.reason, window != nil {
      let fade = CATransition()
      fade.type = .fade
      fade.duration = 0.15
      layer?.add(fade, forKey: kCATransition)
    }
    self.reason = reason
    self.animating = animating
    localize()
  }

  func localize() {
    let content = reason.map(Self.content)
    let strings = ShellStrings.shared
    symbol.image = content?.symbol.flatMap {
      NSImage(systemSymbolName: $0, accessibilityDescription: nil)
    }
    symbol.contentTintColor = .secondaryLabelColor
    title.stringValue = content.map { strings.text($0.title) } ?? ""
    detail.stringValue = content?.detail.map { strings.text($0) } ?? ""
    // The detail tells the user what to do, so it reads in the primary color; secondary label
    // falls under 4.5:1 on the light surface fill. The title's weight carries the hierarchy.
    detail.textColor = .labelColor
    action.title = strings.text(.computerMonitorOpenPrivacySettings)
    if animating, content != nil, content?.symbol == nil {
      spinner.startAnimation(nil)
    } else {
      spinner.stopAnimation(nil)
    }
    needsLayout = true
  }

  /// Only the action takes the pointer; a press anywhere else belongs to the tile.
  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit === action ? hit : nil
  }

  override func layout() {
    super.layout()
    let content = reason.map(Self.content)
    let width = max(0, bounds.width - 32)
    var indicator: NSView? = content.map { $0.symbol == nil ? spinner : symbol }
    var detailShown = content?.detail != nil
    let actionShown = content?.hasAction == true
    title.preferredMaxLayoutWidth = width
    let font = title.font ?? .systemFont(ofSize: 13)
    let twoLines = ceil(NSLayoutManager().defaultLineHeight(for: font) * 2)
    let titleHeight = min(
      twoLines, ceil(title.sizeThatFits(CGSize(width: width, height: twoLines)).height))
    let detailHeight = ceil(detail.fittingSize.height)
    let actionSize = action.fittingSize
    func total() -> CGFloat {
      var height = content == nil ? 0 : titleHeight
      if let indicator { height += Self.size(of: indicator).height + 8 }
      if detailShown { height += 2 + detailHeight }
      if actionShown { height += 10 + actionSize.height }
      return height
    }
    let available = bounds.height - 16
    if total() > available { detailShown = false }
    if total() > available { indicator = nil }
    spinner.isHidden = indicator !== spinner
    symbol.isHidden = indicator !== symbol
    title.isHidden = content == nil
    detail.isHidden = !detailShown
    action.isHidden = !actionShown
    var y = ((bounds.height - total()) / 2).rounded()
    func place(_ view: NSView, width: CGFloat, height: CGFloat, after gap: CGFloat) {
      view.frame = CGRect(
        x: ((bounds.width - width) / 2).rounded(), y: y, width: width, height: height)
      y += height + gap
    }
    if let indicator {
      let size = Self.size(of: indicator)
      place(indicator, width: size.width, height: size.height, after: 8)
    }
    place(title, width: width, height: titleHeight, after: 2)
    if detailShown { place(detail, width: width, height: detailHeight, after: 10) }
    if actionShown {
      if !detailShown { y += 8 }
      place(action, width: min(width, actionSize.width), height: actionSize.height, after: 0)
    }
  }

  /// Opens Screen Recording in Privacy & Security, where the user allows it; the monitor never
  /// asks for the permission itself.
  static func openPrivacySettings() {
    if let url = PermissionPane.screenRecording.settingsURL { NSWorkspace.shared.open(url) }
  }

  @objc private func actionPressed() { Self.openPrivacySettings() }

  /// The small spinner has no fitting size of its own; the symbol takes its image's.
  private static func size(of indicator: NSView) -> CGSize {
    indicator is NSProgressIndicator ? CGSize(width: 16, height: 16) : indicator.fittingSize
  }

  private struct Content: Equatable {
    /// Nil shows the spinner.
    let symbol: String?
    let title: ComputerMonitorStringKey
    var detail: ComputerMonitorStringKey?
    var hasAction = false
  }

  /// The title `reason` shows, which is also the tile's accessibility value.
  static func title(_ reason: PreviewReason) -> ComputerMonitorStringKey { content(reason).title }

  private static func content(_ reason: PreviewReason) -> Content {
    switch reason {
    case .starting: Content(symbol: nil, title: .computerMonitorStarting)
    case .blank: Content(symbol: "rectangle.dashed", title: .computerMonitorBlank)
    case .suspended: Content(symbol: "pause.circle", title: .computerMonitorSuspended)
    case .captureFailed:
      Content(symbol: "exclamationmark.triangle", title: .computerMonitorCaptureFailed)
    case .locked:
      Content(
        symbol: "lock", title: .computerMonitorLocked, detail: .computerMonitorLockedDetail)
    case .targetUnavailable:
      Content(symbol: "eye.slash", title: .computerMonitorTargetUnavailable)
    case .permission:
      Content(symbol: "hand.raised", title: .computerMonitorPermission, hasAction: true)
    case .disconnected:
      Content(symbol: "bolt.horizontal.circle", title: .computerMonitorDisconnected)
    }
  }
}
