import AICore
import AppKit
import QuartzCore

/// Native fallback recovery card replacing ``WindowLoadingView`` after a 5-second stalled boot or
/// immediately upon the 4th WebContent crash within 60 seconds (`03-contracts-routes-and-ui.md`
/// §4.3).
///
/// Owns a single `GlassSurface.fill(reduceTransparency:)` background layer (never stacked over
/// `WindowLoadingView` or a second `NativeMaterialView`), preserves window dragging via
/// `mouseDownCanMoveWindow == true`, displays ONLY pre-scrubbed `ServiceUnavailableDescriptor`
/// summaries, and adapts its bilingual button footer horizontally or vertically on
/// `ShellStrings.didChange`.
final class WindowRecoveryView: NSView {
  enum Reason: Equatable, Sendable {
    case timeout
    case crashed
  }

  struct ServiceContext: Equatable, Sendable {
    var isDevelopment = false
    var unavailable: ServiceUnavailable?
    var lastFailureSummary: String?
  }

  private(set) var reason: Reason
  var serviceContextProvider: () -> ServiceContext
  var onRestartService: (() async throws -> Void)?
  var onExportDiagnostics: (() async throws -> Bool)?
  var onReloadPage: (() -> Void)?

  private let titleLabel = NSTextField(wrappingLabelWithString: "")
  private let bodyLabel = NSTextField(wrappingLabelWithString: "")
  private let feedbackLabel = NSTextField(wrappingLabelWithString: "")
  private(set) lazy var restartButton = RecoveryActionButton(
    prominence: .secondary, target: self, action: #selector(handleRestartClicked))
  private(set) lazy var exportButton = RecoveryActionButton(
    prominence: .secondary, target: self, action: #selector(handleExportClicked))
  private(set) lazy var reloadButton = RecoveryActionButton(
    prominence: .primary, target: self, action: #selector(handleReloadClicked))

  private(set) var isStackedVertically = false
  private var feedbackMessage: String?
  private var isPerformingAction = false
  private var observingBackground = false
  private var reduceTransparency: ReduceTransparencyObserver?
  private var stringsObserver: NSObjectProtocol?

  var actionButtons: [RecoveryActionButton] { [restartButton, exportButton, reloadButton] }
  var renderedTitleText: String { titleLabel.stringValue }
  var renderedBodyText: String { bodyLabel.stringValue }
  var renderedFeedbackText: String? { feedbackMessage }

  init(
    frame frameRect: NSRect,
    reason: Reason,
    serviceContextProvider: @escaping () -> ServiceContext = { ServiceContext() }
  ) {
    self.reason = reason
    self.serviceContextProvider = serviceContextProvider
    super.init(frame: frameRect)
    wantsLayer = true

    for field in [titleLabel, bodyLabel, feedbackLabel] {
      field.maximumNumberOfLines = 0
      field.isEditable = false
      field.isSelectable = false
      field.drawsBackground = false
      field.isBezeled = false
      addSubview(field)
    }
    for button in actionButtons { addSubview(button) }

    observingBackground = true
    observePanelBackground()
    reduceTransparency = ReduceTransparencyObserver { [weak self] _ in
      self?.refreshAppearance()
    }
    stringsObserver = NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.refreshContentAndLayout() }
    }
    refreshContentAndLayout()
  }

  isolated deinit {
    reduceTransparency?.stop()
    if let stringsObserver { NotificationCenter.default.removeObserver(stringsObserver) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var isFlipped: Bool { true }
  override var mouseDownCanMoveWindow: Bool { true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshAppearance()
  }

  func updateReason(_ next: Reason) {
    reason = next
    refreshContentAndLayout()
  }

  func stop() {
    observingBackground = false
    reduceTransparency?.stop()
    reduceTransparency = nil
    if let stringsObserver { NotificationCenter.default.removeObserver(stringsObserver) }
    stringsObserver = nil
  }

  func refreshContentAndLayout() {
    let strings = ShellStrings.shared
    restartButton.configureLabel(strings.text(DiagnosticsStringKey.recoveryActionRestartService))
    exportButton.configureLabel(strings.text(DiagnosticsStringKey.recoveryActionExportDiagnostics))
    reloadButton.configureLabel(strings.text(DiagnosticsStringKey.recoveryActionReloadPage))
    refreshAppearance()
    needsLayout = true
  }

  private func refreshAppearance() {
    let dark = GlassSurface.isDark
    layer?.backgroundColor =
      GlassSurface.fill(reduceTransparency: ReduceTransparencyObserver.isReduced).cgColor

    let fg =
      dark
      ? NSColor(srgbRed: 0.98, green: 0.98, blue: 0.98, alpha: 1)
      : NSColor(srgbRed: 0.05, green: 0.05, blue: 0.06, alpha: 1)
    let muted =
      dark
      ? NSColor(srgbRed: 0.72, green: 0.72, blue: 0.75, alpha: 1)
      : NSColor(srgbRed: 0.36, green: 0.36, blue: 0.40, alpha: 1)

    let strings = ShellStrings.shared
    let titleText = strings.text(
      reason == .crashed
        ? DiagnosticsStringKey.recoveryTitleCrashed
        : DiagnosticsStringKey.recoveryTitleTimeout)
    let bodyText = resolveScrubbedBodyText(strings: strings)

    titleLabel.attributedStringValue = Self.styledText(
      titleText, font: .systemFont(ofSize: 17, weight: .semibold), color: fg, lineHeight: 24)
    bodyLabel.attributedStringValue = Self.styledText(
      bodyText, font: .systemFont(ofSize: 13, weight: .regular), color: muted, lineHeight: 19)
    if let feedbackMessage, !feedbackMessage.isEmpty {
      feedbackLabel.isHidden = false
      feedbackLabel.attributedStringValue = Self.styledText(
        feedbackMessage, font: .systemFont(ofSize: 12, weight: .medium), color: fg, lineHeight: 17)
    } else {
      feedbackLabel.isHidden = true
      feedbackLabel.stringValue = ""
    }
    for button in actionButtons {
      button.isEnabled = !isPerformingAction
      button.refreshAppearance()
    }
  }

  private func resolveScrubbedBodyText(strings: ShellStrings) -> String {
    let ctx = serviceContextProvider()
    if ctx.isDevelopment, ctx.unavailable == .developmentServiceNotRunning {
      return strings.text(DiagnosticsStringKey.recoveryBodyRendererStalled) + "\n"
        + strings.text(DiagnosticsStringKey.recoveryBodyDevHint)
    }
    if let unavailable = ctx.unavailable {
      switch unavailable {
      case .failed, .stoppedTooOften, .invalidEndpoint:
        let descriptor = ServiceUnavailableDescriptor.describe(
          unavailable, lastFailure: ctx.lastFailureSummary)
        return strings.text(DiagnosticsStringKey.recoveryBodyServiceFailed, descriptor.summary)
      case .starting, .developmentServiceNotRunning, .stopped:
        break
      }
    }
    return strings.text(DiagnosticsStringKey.recoveryBodyRendererStalled)
  }

  override func layout() {
    super.layout()
    let horizontalInset: CGFloat = bounds.width < 360 ? 24 : 40
    let maxRowWidth = max(120, bounds.width - horizontalInset * 2)
    let availableWidth = min(460, maxRowWidth)
    let buttonHeight: CGFloat = 32
    let buttonGap: CGFloat = 8

    for field in [titleLabel, bodyLabel, feedbackLabel] {
      field.preferredMaxLayoutWidth = availableWidth
    }
    let titleH = Self.measuredHeight(of: titleLabel, width: availableWidth)
    let bodyH = Self.measuredHeight(of: bodyLabel, width: availableWidth)
    let feedbackH =
      feedbackLabel.isHidden ? 0 : Self.measuredHeight(of: feedbackLabel, width: availableWidth)

    let widths = actionButtons.map(\.naturalLabelWidth)
    let horizontalRowWidth =
      widths.reduce(0, +) + CGFloat(max(0, actionButtons.count - 1)) * buttonGap
    let stackVertically = maxRowWidth < horizontalRowWidth
    isStackedVertically = stackVertically

    let footerH =
      stackVertically
      ? CGFloat(actionButtons.count) * buttonHeight
        + CGFloat(max(0, actionButtons.count - 1)) * buttonGap
      : buttonHeight

    var totalH = titleH + 8 + bodyH + 20 + footerH
    if feedbackH > 0 { totalH += 12 + feedbackH }

    let startY = max(36, ((bounds.height - totalH) / 2).rounded())
    let x = ((bounds.width - availableWidth) / 2).rounded()

    titleLabel.frame = NSRect(x: x, y: startY, width: availableWidth, height: titleH)
    var cursorY = startY + titleH + 8
    bodyLabel.frame = NSRect(x: x, y: cursorY, width: availableWidth, height: bodyH)
    cursorY += bodyH

    if feedbackH > 0 {
      cursorY += 12
      feedbackLabel.frame = NSRect(x: x, y: cursorY, width: availableWidth, height: feedbackH)
      cursorY += feedbackH
    }
    cursorY += 20

    if stackVertically {
      for button in actionButtons {
        button.frame = NSRect(x: x, y: cursorY, width: availableWidth, height: buttonHeight)
        cursorY += buttonHeight + buttonGap
      }
    } else {
      var buttonX = ((bounds.width - horizontalRowWidth) / 2).rounded()
      for (index, button) in actionButtons.enumerated() {
        let w = widths[index]
        button.frame = NSRect(x: buttonX, y: cursorY, width: w, height: buttonHeight)
        buttonX += w + buttonGap
      }
    }
  }

  @objc private func handleRestartClicked() {
    guard !isPerformingAction else { return }
    runButtonAction { [weak self] in
      try await self?.onRestartService?()
      self?.feedbackMessage = nil
    }
  }

  @objc private func handleExportClicked() {
    guard !isPerformingAction else { return }
    runButtonAction { [weak self] in
      let saved = try await self?.onExportDiagnostics?() ?? false
      if saved {
        self?.feedbackMessage = ShellStrings.shared.text(
          DiagnosticsStringKey.recoveryFeedbackExported)
      }
    }
  }

  @objc private func handleReloadClicked() {
    guard !isPerformingAction else { return }
    feedbackMessage = nil
    onReloadPage?()
  }

  private func runButtonAction(_ work: @escaping @MainActor () async throws -> Void) {
    isPerformingAction = true
    refreshAppearance()
    Task { @MainActor [weak self] in
      defer {
        self?.isPerformingAction = false
        self?.refreshContentAndLayout()
      }
      do {
        try await work()
      } catch {
        let raw = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        self?.feedbackMessage = DiagnosticsScrubber.scrubInlineSummary(raw, maxUTF8Bytes: 170)
      }
    }
  }

  private func observePanelBackground() {
    guard observingBackground else { return }
    withObservationTracking {
      _ = PanelBackground.shared.setting
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.observingBackground else { return }
        self.refreshAppearance()
        self.observePanelBackground()
      }
    }
  }

  private static func styledText(
    _ text: String, font: NSFont, color: NSColor, lineHeight: CGFloat
  ) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byWordWrapping
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    return NSAttributedString(
      string: text,
      attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
  }

  private static func measuredHeight(of field: NSTextField, width: CGFloat) -> CGFloat {
    guard width > 0 else { return 0 }
    return ceil(field.sizeThatFits(NSSize(width: width, height: .greatestFiniteMagnitude)).height)
  }
}
