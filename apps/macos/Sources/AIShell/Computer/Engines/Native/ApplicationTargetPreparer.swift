import AICore
import AppKit
import OSLog

/// `computer.prepareApplication` (spec §10, §11): registers an app a person chose in Settings as
/// an application target. The shell finds where the app is installed, reads its bundle id and
/// code-signing team itself, saves the binding through the shell-only
/// `POST /v1/computer/bindings`, and answers a read-only probe of what it can see now (standard
/// windows, a readable accessibility tree, the screenshot permission). It never opens, launches
/// or activates the app. Which window a run acts on is the engine's root-window rule, never a
/// choice asked of the person.
final class ApplicationTargetPreparer {
  typealias SaveBinding = (SaveComputerBindingRequestWire) async throws -> TargetBindingWire
  typealias PrepareResult = ComputerPrepareApplicationResult

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  private let saveBinding: SaveBinding
  private let systemPanels: SystemPanels
  private let workspace: NSWorkspace
  private var preparing = false

  init(
    saveBinding: @escaping SaveBinding, systemPanels: SystemPanels,
    workspace: NSWorkspace = .shared
  ) {
    self.saveBinding = saveBinding
    self.systemPanels = systemPanels
    self.workspace = workspace
  }

  func prepareApplication(_ params: ComputerPrepareApplicationParams) async -> PrepareResult {
    guard !preparing, !systemPanels.isOpen else { return .notOk(.init(reason: .busy)) }
    preparing = true
    defer { preparing = false }
    // Atd driving itself, this build or another, would act on the person's own conversation.
    let own = Bundle.main.bundleIdentifier
    guard params.bundleId != own, params.bundleId != "com.junerdd.ai",
      !params.bundleId.hasPrefix("com.junerdd.ai.")
    else { return .notOk(.init(reason: .unsupported)) }
    guard let url = workspace.urlForApplication(withBundleIdentifier: params.bundleId) else {
      Self.log.info("prepareApplication: \(params.bundleId, privacy: .public) is not installed.")
      return .notOk(.init(reason: .notInstalled))
    }
    let path = url.path(percentEncoded: false)
    guard let identity = await NativeTargetProbe.detached({ NativeAppIdentity.read(path: path) })
    else { return .notOk(.init(reason: .notInstalled)) }
    guard identity.bundleId == params.bundleId else { return .notOk(.init(reason: .unsupported)) }
    let binding: TargetBindingWire
    do {
      binding = try await saveBinding(
        .init(
          content: .native(
            label: params.label, bundleId: identity.bundleId, appName: identity.name,
            appPath: identity.path, teamId: identity.teamId)))
    } catch {
      Self.log.error("prepareApplication could not save the binding: \(error, privacy: .public)")
      return .notOk(.init(reason: .unavailable))
    }
    return .ok(
      .init(
        bindingId: binding.bindingId, revision: binding.revision,
        probe: await probe(identity)))
  }

  /// What the host can read of the app now, without starting or touching it.
  private func probe(_ identity: NativeAppIdentity) async -> PrepareResult.Ok.Probe {
    let screenshot = CGPreflightScreenCaptureAccess()
    guard let pid = identity.runningInstances().first?.processIdentifier, AXIsProcessTrusted()
    else {
      return .init(windows: 0, tree: false, screenshot: screenshot)
    }
    let (count, tree) = await NativeTargetProbe.detached {
      (
        NativeSurfaceProbe.standardWindows(pid: pid).count,
        NativeSurfaceProbe.treeReadable(pid: pid)
      )
    }
    return .init(windows: count, tree: tree, screenshot: screenshot)
  }
}
