/// The shell's answer to a page's `approval.request` (`McpApprovalGate` in
/// apps/desktop/electron/service/mcp-approval.ts). The page names a server and nothing else:
/// the gate reads what would run from the service with the shell's own token, has the user
/// confirm exactly that, and approves with the fingerprint it showed, so a change in between
/// is refused (`changed`) rather than approved unseen.
///
/// One request runs at a time and none starts while another native dialog is up (`busy`). A
/// Cancel refuses the same launch (same server, same fingerprint) for ``cancelCooldown``
/// without asking again, against a page that re-asks in a loop.
@MainActor
public final class McpApprovalGate {
  /// How long a cancelled launch is refused without a dialog (`CANCEL_COOLDOWN_MS`).
  public static let cancelCooldown: Duration = .seconds(30)

  /// What the user did with the confirmation.
  public enum Answer: Sendable {
    case allow
    case cancel
    /// No dialog showed: another confirmation took the screen first.
    case notShown
  }

  /// The two shell-only routes, bound to the service as it is for one request.
  public struct Service: Sendable {
    public let details: @Sendable (_ serverId: String) async throws -> McpLaunchApprovalDetails
    public let approve: @Sendable (McpLaunchApproveRequest) async throws -> McpLaunchApproveOutcome

    public init(
      details: @escaping @Sendable (_ serverId: String) async throws -> McpLaunchApprovalDetails,
      approve: @escaping @Sendable (McpLaunchApproveRequest) async throws -> McpLaunchApproveOutcome
    ) {
      self.details = details
      self.approve = approve
    }
  }

  public typealias Result = ApprovalRequestResult

  private let isBusy: @MainActor () -> Bool
  private let confirm: @MainActor (McpLaunchApprovalDetails) async -> Answer
  private let now: @MainActor () -> ContinuousClock.Instant
  private var pending = false
  /// The launch last cancelled per server, refused without a dialog until `until`.
  private var cancelled: [String: (fingerprint: String, until: ContinuousClock.Instant)] = [:]

  /// - Parameters:
  ///   - isBusy: whether a native dialog or system panel already holds the screen.
  ///   - confirm: shows the confirmation for these details.
  ///   - now: the clock of the cancel cooldown.
  public init(
    isBusy: @escaping @MainActor () -> Bool,
    confirm: @escaping @MainActor (McpLaunchApprovalDetails) async -> Answer,
    now: @escaping @MainActor () -> ContinuousClock.Instant
  ) {
    self.isBusy = isBusy
    self.confirm = confirm
    self.now = now
  }

  /// `connect` gives the service's routes, or nil without a service (`unavailable`). A failed
  /// details read or approve throws; the page's call rejects with it.
  public func request(
    serverId: String, connect: () async -> Service?
  ) async throws -> Result {
    if pending || isBusy() { return Self.refused(.busy) }
    pending = true
    defer { pending = false }
    guard let service = await connect() else { return Self.refused(.unavailable) }
    let details = try await service.details(serverId)
    if details.state == .approved { return .approved(.init()) }
    let instant = now()
    cancelled = cancelled.filter { $0.value.until > instant }
    if cancelled[serverId]?.fingerprint == details.fingerprint { return Self.refused(.cancelled) }
    // The details read awaited; another dialog may have opened meanwhile.
    if isBusy() { return Self.refused(.busy) }
    switch await confirm(details) {
    case .notShown:
      return Self.refused(.busy)
    case .cancel:
      cancelled[serverId] = (details.fingerprint, now() + Self.cancelCooldown)
      return Self.refused(.cancelled)
    case .allow:
      cancelled[serverId] = nil
      switch try await service.approve(McpLaunchApproveRequest(approving: details)) {
      case .approved: return .approved(.init())
      case .changed: return Self.refused(.changed)
      }
    }
  }

  private static func refused(_ reason: Result.NotApproved.Reason) -> Result {
    .notApproved(.init(reason: reason))
  }
}
