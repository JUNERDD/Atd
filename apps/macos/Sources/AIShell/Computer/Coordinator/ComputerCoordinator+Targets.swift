import AICore
import Foundation

/// `targets` and `status`: resolving bindings and answering from the host journal.
extension ComputerCoordinator {
  func resolveTargets(_ request: HostRequestWire, bindings: [TargetBindingWire]) async
    -> HostReplyWire
  {
    guard let generation = host.generation else {
      return .failed(request, .locked, "This host does not hold the computer host lock.")
    }
    var refs: [TargetRefWire] = []
    var unavailable: [HostReplyValueWire.Unavailable] = []
    let context = EngineResolveContext(
      runId: request.envelope.runId, unattended: request.envelope.unattended,
      deadline: deadline(of: request),
      isStopping: { [weak self] in
        guard let self else { return true }
        return self.stopping
          || self.cancelled.isCancelled(
            runId: request.envelope.runId, operationId: request.envelope.operationId)
      }, foreground: ForegroundPolicy.allows(request.envelope))
    for binding in bindings {
      do throws(ComputerFailure) {
        try context.check()
        let engine = try usableEngine(binding.kind, request: request, screenshot: false)
        try await engines.ensureStarted(engine)
        try context.check()
        let ref = try await engine.resolve(binding, generation: generation, context: context)
        // A ref dropped here is never handed out, so what resolving prepared for it is undone.
        do throws(ComputerFailure) {
          try context.check()
          guard ref.bindingId == binding.bindingId, ref.bindingRevision == binding.revision,
            ref.hostGeneration == generation, ref.engine == engine.id,
            ref.engineGeneration == engine.generation
          else {
            throw ComputerFailure(.engineFailed, "The engine resolved another target.")
          }
        } catch {
          await engine.releaseTarget(ref)
          throw error
        }
        targets.record(ref, binding: binding, runId: request.envelope.runId)
        refs.append(ref)
      } catch {
        Self.log.info(
          "Binding \(binding.bindingId, privacy: .public) unavailable: \(error.message, privacy: .public)"
        )
        unavailable.append(.init(bindingId: binding.bindingId, error: error.wire))
      }
    }
    return .ok(request, .targets(refs: refs, unavailable: unavailable))
  }

  func status(_ request: HostRequestWire, actionIds: [String]) -> HostReplyWire {
    guard let journal = host.journal else {
      return .failed(request, .locked, "This host does not hold the computer host journal.")
    }
    let records = actionIds.compactMap { journal.entry(for: $0) }.map(HostActionRecordWire.init)
    return .ok(request, .status(records: records))
  }

  // MARK: Add-ons

  /// The add-on installs changed (``AddonCatalog``): engines whose executables changed stop, and
  /// the refs of their generation go stale.
  func installEngines(_ binaries: EngineBinaries) async {
    await previews.stopAll()
    for id in await engines.install(binaries) {
      targets.invalidate(engine: id)
      previews.remove(engine: id)
    }
  }

  // MARK: Shared checks

  /// The engine for targets of `kind`, if this request may use it: registered, qualified for an
  /// unattended request, with the permissions it needs granted now, and, for an unattended
  /// screenshot of a native target, with screen-capture consent prepared in Settings, since an
  /// unattended run never prompts (plan §8.3, I7).
  func usableEngine(_ kind: ComputerTargetKind, request: HostRequestWire, screenshot: Bool)
    throws(ComputerFailure) -> any ComputerEngine
  {
    let id = kind.engine
    guard let engine = engines.engine(id) else {
      throw ComputerFailure(.notQualified, "No \(id.rawValue) engine is available on this Mac.")
    }
    let unattended = request.envelope.unattended
    if unattended, engine.profile.qualification != .qualified {
      throw ComputerFailure(
        .notQualified, "The \(id.rawValue) engine is not qualified for unattended runs.")
    }
    if let missing = ComputerScreenState.missingPermission(kind: kind, screenshot: screenshot) {
      throw missing
    }
    if screenshot, kind == .native, unattended, !captureConsent.isPrepared {
      throw Self.consentMissing
    }
    return engine
  }

  static let consentMissing = ComputerFailure(
    .needsConsent,
    "Screen-capture consent is not prepared for this Atd build, and an unattended run never "
      + "prompts for it; nothing was captured.")

  /// The request's deadline on the continuous clock.
  func deadline(of request: HostRequestWire) -> ContinuousClock.Instant {
    HostRequestPolicy.instant(
      for: request.envelope.deadline, now: Date(), clockNow: ContinuousClock.now)
  }

  /// What an engine failure makes stale.
  func invalidate(after failure: ComputerFailure, refId: String) {
    switch failure.code {
    case .targetChanged, .targetUnavailable:
      targets.invalidate(refId: refId)
      previews.remove(refId: refId)
    // The person was using the target: what was observed of it is void.
    case .staleObservation, .targetInUse: targets.invalidateObservation(refId: refId)
    default: break
    }
  }

  static func wire(_ refusal: ClaimRefusal) -> ComputerErrorWire {
    let (code, message): (ComputerErrorCode, String) =
      switch refusal {
      case .busy, .interactiveScreen:
        (.busy, "The target or the screen is in use; try again shortly.")
      case .admissionClosed(.hostNotHeld): (.locked, "Another Atd instance is the computer host.")
      case .admissionClosed(.unsettled):
        (.busy, "Earlier computer actions are not reconciled yet; writes wait until they are.")
      case .admissionClosed(.stopping): (.hostUnavailable, "Atd is quitting.")
      case .timeout: (.timeout, "The target stayed busy until the request's deadline.")
      case .cancelled: (.cancelled, "The run's computer work was cancelled.")
      case .reentrant, .outOfOrder: (.engineFailed, "The host could not claim the target.")
      }
    return ComputerErrorWire(code: code, message: message)
  }

}
