import AICore
import AppKit

/// The welcome guide's entry points: the bridge's `onboarding.open`, `onboarding.settle` and
/// `onboarding.close`, and the Welcome Guide menu item. When the guide first appears is the panel page's decision, from
/// the service settings; the shell keeps no flag of its own.
extension ShellController {
  /// Shows the guide, reusing an open one, and steps an unpinned panel aside so the guide stands
  /// alone. The guide asks for Accessibility in context, so it retires the first-launch prompt
  /// (the panel page calls this before its first `toolbar.set`, and calls arrive in order) and
  /// keeps summons from prompting while it is open.
  func openOnboarding() {
    // The guide would activate and order in against the capture overlays.
    guard !isCapturingScreenshot else { return }
    trust.skipFirstLaunchPrompt()
    onboarding.onOpenChange = { [weak self] in self?.onboardingOpenChanged() }
    // Shown first, so the panel hides without key status: hiding a key panel first would
    // deactivate the app just before the guide activates it.
    onboarding.open(title: ShellStrings.shared.text(.windowOnboardingTitle))
    if panel.isVisible, !isPinned { hidePanel() }
  }

  private func onboardingOpenChanged() {
    let open = onboarding.host != nil
    trust.guideAsks = open
    presence.applyDockVisibility(windowOpen: keepsDockIcon, restoreFocus: open)
    if !open { toolbar.hidePractice() }
  }

  /// A Dock or Finder reopen returns to an existing guide, then to an open settings window,
  /// before showing the task panel.
  func reopen() {
    guard !systemPanels.isOpen, !isCapturingScreenshot else { return }
    if onboarding.host != nil {
      openOnboarding()
    } else if settings.isOpen {
      openSettings(commandId: nil, section: nil)
    } else {
      showPanel()
    }
  }

  /// Keeps the renderer's intro-completion bridge entry point.
  func settleOnboarding() {
    onboarding.settle()
  }

  /// The guide's practice selection (`onboarding.selection`), from its own web view only: a rect
  /// shows the real selection toolbar beside it, under the toolbar's own conditions, and `null`
  /// (or a rect that is off the web view) hides it.
  func setPracticeSelection(_ post: OnboardingSelectionPost, from sender: WebViewHost) {
    guard sender === onboarding.host else { return }
    if let rect = post.rect,
      let screen = onboarding.screenRect(
        CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height), from: sender)
    {
      toolbar.showPractice(selection: screen, text: post.text)
    } else {
      toolbar.hidePractice()
    }
  }

  /// Closes the guide; `summon` then shows the panel as `window.show` does.
  func closeOnboarding(summon: Bool) {
    onboarding.close()
    if summon { showPanel() }
  }
}
