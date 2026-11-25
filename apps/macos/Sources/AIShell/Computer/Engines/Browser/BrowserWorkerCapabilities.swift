import AICore
import Foundation

/// What the browser worker does on a page, whichever browser it drives: the steps it performs, the
/// channel each one's input takes, and the per-target capabilities an engine's refs carry. Each
/// browser engine decides which of them it has verified.
enum BrowserWorkerCapabilities {
  /// The pinned playwright-core the worker runs: a browser engine profile's engine version.
  static let playwrightVersion = "1.63.0"
  /// The steps the worker performs, every one in the background.
  static let actions: [ComputerStepKind] = [
    .navigate, .fill, .press, .scroll, .wait, .clear, .key, .select, .upload,
  ]

  /// What each target supports among `actions`: every step in the background, elements named by
  /// ref or semantically (never by image point), verified only where `verified` lists the step.
  static func target(
    _ actions: [ComputerStepKind] = actions, verified: Set<ComputerStepKind>
  ) -> [TargetCapabilityWire] {
    actions.map { kind in
      TargetCapabilityWire(
        action: kind, locate: kind == .navigate || kind == .wait ? [] : [.element, .semantic],
        delivery: [.background], verified: verified.contains(kind),
        routes: route(of: kind).map { [$0] })
    }
  }

  /// A browser engine's profile: every worker step in the background, every effect, no system
  /// input, for the pinned playwright-core on this Mac.
  static func profile(
    engine: ComputerEngineID, qualification: CapabilityProfileWire.Qualification,
    evidence: String
  ) -> CapabilityProfileWire {
    let system = ProcessInfo.processInfo.operatingSystemVersion
    #if arch(arm64)
      let arch = CapabilityProfileWire.Arch.arm64
    #else
      let arch = CapabilityProfileWire.Arch.x8664
    #endif
    return CapabilityProfileWire(
      engine: engine, engineVersion: playwrightVersion,
      os: "macOS \(system.majorVersion).\(system.minorVersion).\(system.patchVersion)", arch: arch,
      targetKinds: [.browser], actions: actions,
      effects: [.read, .navigate, .input, .click, .invoke, .submit], delivery: [.background],
      affectsSystemInput: false, qualification: qualification, evidence: evidence)
  }

  /// The channel a step's input takes: Chrome's DevTools commands for navigation, text, clicks,
  /// keys and files (`cdp`), or script run in the page for a scroll or a choice in a select
  /// (`script`). A wait sends nothing.
  static func route(of kind: ComputerStepKind) -> ActionResultWire.Route? {
    switch kind {
    case .navigate, .fill, .clear, .press, .key, .upload: .cdp
    case .scroll, .select: .script
    default: nil
    }
  }
}
