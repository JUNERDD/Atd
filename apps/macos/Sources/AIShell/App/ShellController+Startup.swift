import AICore

extension ShellController {
  /// Only the panel's loaded settings resolve the first window. The resident, transparent
  /// panel continues loading normally while the user waits for the guide or the task panel.
  func presentLaunch(_ state: AppStartupParams.State) throws(BridgeError) -> AppStartupResult {
    if state == .onboarding, isCapturingScreenshot {
      throw BridgeError("Finish the screenshot first.")
    }
    switch launchPresentation.resolve(state) {
    case .onboarding:
      openOnboarding()
      return AppStartupResult(onboardingShown: true)
    case .panel:
      // The hidden page can focus its composer before settings arrive. A toggle would hide
      // that key panel again; launch explicitly shows it. An already open guide stays in front.
      if !panel.isVisible, onboarding.host == nil {
        panel.dockAtCursor()
        showPanel()
      }
    case nil:
      break
    }
    return AppStartupResult(onboardingShown: false)
  }
}
