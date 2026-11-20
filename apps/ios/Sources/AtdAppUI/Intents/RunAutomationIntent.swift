import AppIntents
import AtdAutomations

/// 运行自动化: what a Shortcuts personal automation runs (到家时 → 运行「到家清单」), and Siri.
///
/// A `LiveActivityIntent`, so the system runs it in the app's process in the background, even
/// with the iPhone locked, and it may start the run's Live Activity there. It runs the steps
/// until the run finishes, stops for the person, or the intent's time is nearly up, and returns
/// what the run found as text: an automation set up with Shortcuts' 朗读文本 after this action
/// reads it aloud. Its copy is in AtdAutomations' `MainBundle/AutomationIntents.xcstrings`.
public struct RunAutomationIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource(
    "runAutomation.title", table: "AutomationIntents")
  public static let description = IntentDescription(
    LocalizedStringResource("runAutomation.description", table: "AutomationIntents"))
  public static let supportedModes: IntentModes = .background
  public static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(
    title: LocalizedStringResource("runAutomation.automation", table: "AutomationIntents"))
  public var automation: AutomationEntity

  public static var parameterSummary: some ParameterSummary {
    Summary("Run \(\.$automation)", table: "AutomationIntents")
  }

  public init() {}

  public init(automation: AutomationEntity) {
    self.automation = automation
  }

  @MainActor
  public func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let outcome =
      await AutomationEngine.shared?.trigger(
        automation.id, source: .shortcuts, budget: AutomationEngine.intentBudget) ?? .missing
    let reply = AutomationReply(outcome)
    return .result(value: reply.value, dialog: IntentDialog("\(reply.dialog)"))
  }
}
