import Foundation

/// What authorizing an automation's computer use would allow (`AutomationComputerApprovalDetails`
/// in packages/agent-contracts/src/computer-http.ts), as `GET
/// /v1/admin/approvals/automation-computer/:automationId` answers it. Only the fields the native
/// confirmation shows and the approve request echoes are read; `approvalHash` covers everything
/// the service sent, so the grant is for exactly the content it computed the hash from.
public struct AutomationComputerApprovalDetails: Decodable, Equatable, Sendable {
  public struct Step: Equatable, Sendable {
    public let stepId: String
    public let label: String
    public let kind: ComputerStepKind
    public let effect: ComputerEffect
  }

  public let automationId: String
  public let revision: Int
  public let name: String
  public let maxSubmits: Int
  public let steps: [Step]
  public let bindings: [TargetBindingWire]
  public let approvalHash: String
  /// Whether a passed trial matches the current content; nothing can be approved without one.
  public let hasPassedTrial: Bool

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    automationId = try container.identifier(.automationId)
    revision = try container.integer(.revision, minimum: 1)
    name = try container.string(.name, minLength: 1, maxLength: 120)
    approvalHash = try container.computerHash(.approvalHash)
    bindings = try container.array(
      .bindings, of: TargetBindingWire.self, maxItems: ComputerWireLimits.maxRunBindings)
    let policy = try container.nestedContainer(keyedBy: PolicyKeys.self, forKey: .policy)
    maxSubmits = try policy.integer(.maxSubmits, minimum: 1, maximum: 5)
    let recipe = try policy.nestedContainer(keyedBy: RecipeKeys.self, forKey: .recipe)
    steps = try recipe.array(.steps, of: StepFields.self, minItems: 1, maxItems: 32).map(\.step)
    hasPassedTrial =
      try container.nullable(.trial) { try container.value($0, Trial.self) }?.result == "passed"
  }

  private struct StepFields: Decodable {
    let step: Step

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: Keys.self)
      let kind = try container.value(.kind, ComputerStepKind.self)
      let effect: ComputerEffect =
        switch kind {
        case .navigate: .navigate
        case .fill, .setValue: .input
        case .press:
          try container.value(.effect, ComputerStepWire.PressEffect.self) == .submit
            ? .submit : .click
        case .scroll, .wait: .read
        // Recipes approve only the semantic steps; an input step can never run unattended.
        case .click, .key, .type, .clear, .menu, .drag, .select, .upload:
          throw DecodingError.dataCorruptedError(
            forKey: .kind, in: container, debugDescription: "A recipe has no \(kind) step.")
        }
      step = Step(
        stepId: try container.string(.stepId, minLength: 1, maxLength: 64),
        label: try container.string(.label, minLength: 1, maxLength: 200), kind: kind,
        effect: effect)
    }

    private enum Keys: String, CodingKey { case stepId, label, kind, effect }
  }

  private struct Trial: Decodable { let result: String }
  private enum Keys: String, CodingKey {
    case automationId, revision, name, policy, bindings, trial, approvalHash
  }
  private enum PolicyKeys: String, CodingKey { case maxSubmits, recipe }
  private enum RecipeKeys: String, CodingKey { case steps }
}

/// The native confirmation of an automation's computer authorization, as text: the automation,
/// every target with what it reaches, every approved step with its effect, and the submit budget.
/// Values from the definition are quoted with invisible characters escaped
/// (``McpApprovalDialog/quoted(_:)``), so a label cannot pass for another line.
public struct AutomationComputerApprovalDialog: Equatable, Sendable {
  public let title: String
  public let message: String
  public let detail: String

  public init(_ details: AutomationComputerApprovalDetails, text: ShellText) {
    title = text(.computerApprovalTitle, McpApprovalDialog.inline(details.name))
    message = text(.computerApprovalMessage, details.maxSubmits)
    var lines: [String] = []
    let field = { (key: ShellStringKey, value: String) in
      let label = text(key)
      return label.hasSuffix("：") ? label + value : label + " " + value
    }
    for binding in details.bindings {
      lines.append(field(.computerApprovalTarget, McpApprovalDialog.quoted(binding.label)))
      switch binding {
      case .browser(let browser):
        let sites = browser.allowedOrigins.map(McpApprovalDialog.quoted).joined(separator: ", ")
        lines.append("  " + field(.computerApprovalSites, sites))
      case .native(let native):
        lines.append("  " + field(.computerApprovalApp, McpApprovalDialog.quoted(native.appName)))
      }
    }
    lines.append(text(.computerApprovalSteps))
    for (index, step) in details.steps.enumerated() {
      let effect: ShellStringKey =
        step.effect == .read
        ? .computerApprovalEffectRead
        : step.effect.isBusiness ? .computerApprovalEffectBusiness : .computerApprovalEffectChange
      lines.append(
        "  \(index + 1). " + McpApprovalDialog.quoted(step.label) + " — " + text(effect))
    }
    detail = lines.joined(separator: "\n")
  }
}
