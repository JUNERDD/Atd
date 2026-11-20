import AppIntents

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
