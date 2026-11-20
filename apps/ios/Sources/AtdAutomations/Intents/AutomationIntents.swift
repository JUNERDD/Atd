import AppIntents

/// 运行自动化: what a Shortcuts personal automation runs (到家时 → 运行「到家清单」), and Siri.
///
/// A `LiveActivityIntent`, so the system runs it in the app's process in the background, even
/// with the iPhone locked, and it may start the run's Live Activity there. It runs the steps
/// until the run finishes, stops for the person, or the intent's time is nearly up, and returns
/// what the run found as text: an automation set up with Shortcuts' 朗读文本 after this action
/// reads it aloud.
///
/// The app and the widget extension both declare it (their packages list `AtdAutomationsPackage`);
/// its copy is in `MainBundle/AutomationIntents.xcstrings`.
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

  public func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let outcome =
      await AutomationEngine.shared?.trigger(
        automation.id, source: .shortcuts, budget: AutomationEngine.intentBudget) ?? .missing
    let reply = AutomationReply(outcome)
    return .result(value: reply.value, dialog: IntentDialog("\(reply.dialog)"))
  }
}

/// 跳过 on a run's Live Activity: passes on the step waiting for the person, then runs the rest,
/// in the app's process and without unlocking.
public struct SkipStepIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource("skipStep.title", table: "AutomationIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .background
  public static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: LocalizedStringResource("skipStep.run", table: "AutomationIntents"))
  public var runID: String

  @Parameter(title: LocalizedStringResource("skipStep.step", table: "AutomationIntents"))
  public var step: Int

  public init() {}

  public init(runID: UUID, step: Int) {
    self.runID = runID.uuidString
    self.step = step
  }

  public func perform() async throws -> some IntentResult {
    if let run = UUID(uuidString: runID) {
      await AutomationEngine.shared?.skip(
        run: run, step: step, budget: AutomationEngine.intentBudget)
    }
    return .result()
  }
}

/// 结束 on the focus timer's Live Activity.
public struct EndFocusIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource("endFocus.title", table: "AutomationIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .background
  public static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: LocalizedStringResource("endFocus.session", table: "AutomationIntents"))
  public var sessionID: String

  public init() {}

  public init(sessionID: UUID) {
    self.sessionID = sessionID.uuidString
  }

  public func perform() async throws -> some IntentResult {
    if let session = UUID(uuidString: sessionID) {
      await AutomationEngine.shared?.endFocus(session: session)
    }
    return .result()
  }
}

/// This module's App Intents, which the app's and the widget extension's packages list: the
/// widget extension draws the Live Activities whose buttons run them.
public struct AtdAutomationsPackage: AppIntentsPackage {}
