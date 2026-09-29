/// Status codes, header names and the replay rule of the `/v1` relay (contract v1).
public enum RelayPolicy {
  /// Carries the manifest epoch on every relayed request; the service answers 409 when it
  /// differs from its own.
  public static let epochHeader = "x-relay-epoch"
  /// Main-token-only manifest route.
  public static let manifestPath = "/v1/admin/routes"

  /// Normalization failure or a request outside the renderer allow-list.
  public static let deniedStatus = 403
  /// The manifest is still being fetched after ``manifestWait``, or could not be fetched.
  public static let unavailableStatus = 503
  /// The service's answer to a stale epoch.
  public static let epochConflictStatus = 409
  /// How long a request waits for a manifest fetch in flight before it answers 503.
  public static let manifestWait: Duration = .seconds(5)

  public enum FollowUp: Equatable, Sendable {
    /// Hand the response to the page.
    case deliver
    /// Drop the manifest, fetch a new one, and send the request once more. Safe for any
    /// method: the service refuses a stale epoch before the route handler runs.
    case refetchManifestAndReplay
  }

  /// What to do with an upstream response. A 409 is replayed once; a second 409 reaches the
  /// page like any other answer.
  public static func followUp(status: Int, replayed: Bool) -> FollowUp {
    status == epochConflictStatus && !replayed ? .refetchManifestAndReplay : .deliver
  }
}
