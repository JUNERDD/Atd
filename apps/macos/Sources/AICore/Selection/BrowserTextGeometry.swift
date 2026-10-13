/// Where character geometry comes from in Chromium browsers, for the typing trace
/// (``InsertionTrace``). Chromium answers character bounds only once its accessibility runs in
/// complete mode, which builds inline text boxes for the whole app; the basic mode the shell's
/// reads put it in has none, and macOS offers no way to load them for one field. An assistive
/// app asks for complete mode by setting `AXEnhancedUserInterface` on the application, which
/// Chromium honours about two seconds later. So the shell arms the browser a command was summoned
/// from (``Leases``), well before the answer is typed, and lets go once it is typed or after
/// ``lease`` without a write.
///
/// Only the browsers in ``browsers`` are armed. Electron editors (VS Code, Cursor and their
/// kin) take complete mode for a screen reader, ask about it and write a user setting, so no
/// Electron app is armed, and neither is an app that had complete mode before the shell asked.
public enum BrowserTextGeometry {
  /// The Chromium browsers armed for the trace, by bundle identifier.
  public static let browsers: Set<String> = [
    "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev",
    "com.google.Chrome.canary", "org.chromium.Chromium", "com.microsoft.edgemac",
    "com.microsoft.edgemac.Beta", "com.microsoft.edgemac.Dev", "com.microsoft.edgemac.Canary",
    "com.brave.Browser", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
    "company.thebrowser.Browser", "company.thebrowser.dia", "at.studio.AsideBrowser",
  ]
  /// How long an armed browser stays armed without a write.
  public static let lease: Duration = .seconds(60)
  /// How long it stays armed after a write, for the trace's last reads.
  public static let linger: Duration = .seconds(1)

  /// Whether the app with `bundleIdentifier` is armed when a command is summoned from it.
  public static func arms(_ bundleIdentifier: String?) -> Bool {
    bundleIdentifier.map(browsers.contains) ?? false
  }

  /// The apps the shell armed, by process identifier, each until a time on `Instant`'s clock.
  /// The shell turns complete mode on only for an app it holds no lease on, and off only for
  /// one whose mode it turned on itself (``confirm(_:)``), so a mode the app had before stays
  /// as it was.
  public struct Leases<Instant: Comparable & Sendable>: Equatable, Sendable {
    private struct Lease: Equatable, Sendable {
      var until: Instant
      var owned: Bool
    }

    private var leases: [Int32: Lease] = [:]

    public init() {}

    /// Holds `pid` until `until`, or later when it is held longer already; true when it was not
    /// held, so the caller turns its complete mode on (and then reports ``confirm(_:)``).
    public mutating func request(_ pid: Int32, until: Instant) -> Bool {
      if var lease = leases[pid] {
        lease.until = max(lease.until, until)
        leases[pid] = lease
        return false
      }
      leases[pid] = Lease(until: until, owned: false)
      return true
    }

    /// The caller turned `pid`'s complete mode on; false when the lease ended meanwhile, so the
    /// caller turns it off again at once.
    public mutating func confirm(_ pid: Int32) -> Bool {
      guard leases[pid] != nil else { return false }
      leases[pid]?.owned = true
      return true
    }

    /// Ends `pid`'s lease at `until` at the latest, as after a write.
    public mutating func shorten(_ pid: Int32, to until: Instant) {
      guard let lease = leases[pid] else { return }
      leases[pid]?.until = min(lease.until, until)
    }

    /// Ends the leases due by `now`: the apps whose complete mode the caller turns off.
    public mutating func expire(at now: Instant) -> [Int32] {
      let due = leases.filter { $0.value.until <= now }
      for pid in due.keys { leases[pid] = nil }
      return due.filter(\.value.owned).map(\.key).sorted()
    }

    /// Ends every lease, as when the shell quits: the apps whose complete mode it turned on.
    public mutating func expireAll() -> [Int32] {
      defer { leases = [:] }
      return leases.filter(\.value.owned).map(\.key).sorted()
    }

    /// When the next lease ends; nil while none is held.
    public var nextExpiry: Instant? { leases.values.map(\.until).min() }
  }
}
