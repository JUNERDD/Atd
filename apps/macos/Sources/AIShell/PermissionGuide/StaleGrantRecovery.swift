import AppKit
import OSLog
import Security

/// Clears the privacy grants macOS keeps for an earlier signature of this app, and asks again for
/// the ones that were held.
///
/// TCC stores each grant with the designated requirement of the build it was given to. A build
/// that no longer satisfies it (an ad hoc build, whose requirement is its own cdhash, or a release
/// signed with another certificate) loses the grant while System Settings still lists the app as
/// allowed, and switching it off and on keeps the stale requirement: only removing the entry
/// helps. Releases share one certificate (`release.yml`), so this acts only when that certificate
/// changes, on the first launch after the switch from ad hoc releases, and for ad hoc local builds.
///
/// Each launch compares the running requirement with the one recorded when the app last launched,
/// became active or quit, together with the grants held then. A grant held then and missing now
/// under a different requirement is stale: `tccutil` removes its entry and the system prompt asks
/// for it once more, at most once per launch through the trust objects. Without a record (the
/// first launch of a build with this recovery) what was held is unknown; an install that already
/// asked for Accessibility (``AccessibilityTrust/hasAsked``) has the grants it lacks reset and is
/// asked for Accessibility, whose loss would otherwise only hide the selection toolbar, while a
/// screenshot asks for Screen Recording on its own.
enum StaleGrantRecovery {
  struct Record: Equatable {
    var requirement: String
    var held: Set<PermissionPane>
  }

  struct Plan: Equatable {
    var reset: Set<PermissionPane> = []
    var ask: Set<PermissionPane> = []
  }

  private static let requirementKey = "privacyGrants.requirement"
  private static let heldKey = "privacyGrants.held"

  static func plan(previous: Record?, current: Record, hasAsked: Bool) -> Plan {
    guard let previous else {
      guard hasAsked else { return Plan() }
      let missing = Set(PermissionPane.allCases).subtracting(current.held)
      return Plan(reset: missing, ask: missing.intersection([.accessibility]))
    }
    guard previous.requirement != current.requirement else { return Plan() }
    let lost = previous.held.subtracting(current.held)
    return Plan(reset: lost, ask: lost)
  }

  /// Runs once per launch, after both trust objects read their state and before anything asks.
  /// An unsigned build, which has no requirement to compare, records nothing.
  static func start(
    defaults: UserDefaults, accessibility: AccessibilityTrust,
    screenRecording: ScreenRecordingTrust
  ) {
    guard let requirement = designatedRequirement(),
      let bundleID = Bundle.main.bundleIdentifier
    else { return }
    let plan = plan(
      previous: load(from: defaults),
      current: record(requirement, accessibility: accessibility, screenRecording: screenRecording),
      hasAsked: accessibility.hasAsked)
    let save: @MainActor @Sendable () -> Void = { [weak accessibility, weak screenRecording] in
      guard let accessibility, let screenRecording else { return }
      Self.save(
        record(requirement, accessibility: accessibility, screenRecording: screenRecording),
        to: defaults)
    }
    save()
    // A Screen Recording grant applies only from the next launch, so a quit records it as missing
    // and the following launch records it as held.
    for name in [
      NSApplication.didBecomeActiveNotification, NSApplication.willTerminateNotification,
    ] {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { save() }
      }
    }
    guard !plan.reset.isEmpty else { return }
    Task {
      await GrantReset.reset(services: plan.reset.map(\.tccService).sorted(), bundleID: bundleID)
      if plan.ask.contains(.accessibility) { accessibility.promptOncePerLaunch() }
      if plan.ask.contains(.screenRecording) { screenRecording.prompt() }
    }
  }

  private static func record(
    _ requirement: String, accessibility: AccessibilityTrust,
    screenRecording: ScreenRecordingTrust
  ) -> Record {
    var held: Set<PermissionPane> = []
    if accessibility.isTrusted { held.insert(.accessibility) }
    if screenRecording.isTrusted { held.insert(.screenRecording) }
    return Record(requirement: requirement, held: held)
  }

  private static func load(from defaults: UserDefaults) -> Record? {
    guard let requirement = defaults.string(forKey: requirementKey),
      let held = defaults.stringArray(forKey: heldKey)
    else { return nil }
    return Record(requirement: requirement, held: Set(held.compactMap(PermissionPane.init)))
  }

  private static func save(_ record: Record, to defaults: UserDefaults) {
    defaults.set(record.requirement, forKey: requirementKey)
    defaults.set(record.held.map(\.rawValue).sorted(), forKey: heldKey)
  }

  /// The running app's designated requirement, which TCC records with every grant.
  private static func designatedRequirement() -> String? {
    var code: SecCode?
    var staticCode: SecStaticCode?
    var requirement: SecRequirement?
    var text: CFString?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
      SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode,
      SecCodeCopyDesignatedRequirement(staticCode, [], &requirement) == errSecSuccess,
      let requirement,
      SecRequirementCopyString(requirement, [], &text) == errSecSuccess, let text
    else { return nil }
    return text as String
  }
}

/// Removes this app's TCC entries with `tccutil`, which needs no administrator rights for the
/// calling user's own app. A failure is logged and the prompt still follows: it then shows the
/// stale entry, which the user can remove in System Settings.
nonisolated private enum GrantReset {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "privacy-grants")

  @concurrent
  static func reset(services: [String], bundleID: String) async {
    for service in services {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
      process.arguments = ["reset", service, bundleID]
      process.standardInput = FileHandle.nullDevice
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      do {
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus == 0 {
          log.notice("Reset the stale \(service, privacy: .public) grant")
        } else {
          log.error(
            "tccutil reset \(service, privacy: .public) exited with \(process.terminationStatus)")
        }
      } catch {
        log.error("tccutil reset \(service, privacy: .public) did not run: \(error)")
      }
    }
  }
}

extension PermissionPane {
  /// The service name `tccutil` takes.
  var tccService: String {
    switch self {
    case .accessibility: "Accessibility"
    case .screenRecording: "ScreenCapture"
    }
  }
}
