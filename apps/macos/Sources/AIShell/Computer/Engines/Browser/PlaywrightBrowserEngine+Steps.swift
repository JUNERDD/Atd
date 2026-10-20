import AICore
import Foundation
import MCP

/// `perform`: one registered step mapped to one worker tool, on the page of the action's surface.
/// Everything that can refuse a step is checked before the call (the observation is current and
/// of that page, the element resolves to exactly one, the page and any navigation stay on the
/// binding's sites, an upload's files are in the task resource store, unattended steps name
/// elements semantically), so a refusal never dispatches. The worker's `dispatched` decides
/// whether a failure may have reached the page; `fill`, `clear` and `select`, which read the
/// value back, can report the step verified. Every page-changing call names the run's download
/// directory, and the downloads its reply reports go into the action's result.
extension PlaywrightBrowserEngine {
  func perform(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    let (page, instance, binding) = try await target(ref)
    let record = try currentObservation(observation.id, ref: page, refId: ref.id)
    let pageId = try await surfacePage(ref, context.surfaceRefId, instance, binding)
    guard record.pageId == pageId else {
      throw ComputerFailure(
        .staleObservation,
        "The observation is of another surface; observe the surface the action acts on.")
    }
    if context.isStopping() { throw ComputerFailure(.cancelled, "The step was cancelled.") }
    var arguments: [String: Value] = [
      "pageId": .string(pageId), "operationId": .string(context.operationId),
      "allowedOrigins": Self.origins(binding),
    ]
    if case .wait(let condition, let timeoutMs) = step {
      arguments["condition"] = try self.condition(
        condition, refId: ref.id, pageId: pageId, record: record, unattended: context.unattended)
      arguments["timeoutMs"] = .int(timeoutMs)
      context.report(.waiting)
      let (raw, _) = try await call(
        instance, "wait", arguments, timeout: .milliseconds(timeoutMs) + .seconds(5),
        writes: false, pinned: record.workerGeneration)
      let reply = try checked(raw, "wait")
      guard reply.satisfied == true else {
        throw ComputerFailure(.timeout, "The condition did not hold within \(timeoutMs) ms.")
      }
      return EngineStepOutcome(.notDispatched, evidence: reply.evidenceWire)
    }
    let downloads = try downloadDirectory(runId: context.runId)
    arguments["downloadDir"] = .string(downloads.path(percentEncoded: false))
    let write = Write(
      instance: instance, record: record, downloads: downloads, route: Self.route(of: step.kind))
    switch step {
    case .navigate(let url):
      guard BrowserOrigins.allows(url, origins: binding.allowedOrigins) else {
        throw ComputerFailure(.unsupported, "\(url) is outside the target's allowed sites.")
      }
      arguments["url"] = .string(url)
      let reply = try await run(write, "navigate", arguments, context: context)
      let landed = reply.url ?? ""
      return write.outcome(
        reply, landed.hasPrefix(url) ? .verified : .dispatched,
        evidence: reply.evidenceWire.isEmpty
          ? [ComputerEvidenceWire(kind: .url, summary: landed)] : reply.evidenceWire,
        invalidated: "observation")
    case .fill(let locator, let text):
      return try await fill(locator, text, write, binding, arguments, context: context)
    case .clear(let locator):
      // Playwright's fill with no text empties the field the same way.
      return try await fill(locator, "", write, binding, arguments, context: context)
    case .press(let locator, _):
      try onSite(record, binding)
      arguments["ref"] = .string(try element(locator, in: record, context: context))
      arguments["observationVersion"] = .int(record.version)
      arguments["requireEnabled"] = .bool(true)
      let reply = try await run(write, "press", arguments, context: context)
      if let baseline = reply.baselineId {
        pressBaselines[Self.baselineKey(ref.id, pageId)] = baseline
      }
      // Trusted input reached the element; whether the page did what it means is for a
      // following wait or the postcondition to show.
      return write.outcome(reply, .dispatched, invalidated: Self.staleAfter(reply, record))
    case .scroll(let locator, let direction, let amount):
      if let locator {
        guard let locator = locator.element else { throw Self.imagePoint }
        arguments["ref"] = .string(try element(locator, in: record, context: context))
        arguments["observationVersion"] = .int(record.version)
      }
      arguments["direction"] = .string(direction.rawValue)
      arguments["amount"] = .int(amount)
      return write.outcome(try await run(write, "scroll", arguments, context: context), .dispatched)
    case .key(let key, let modifiers, let locator):
      try onSite(record, binding)
      if let locator {
        arguments["ref"] = .string(try element(locator, in: record, context: context))
        arguments["observationVersion"] = .int(record.version)
      }
      arguments["keys"] = .string(BrowserKeyChord.chord(key, modifiers: modifiers ?? []))
      let reply = try await run(write, "key", arguments, context: context)
      return write.outcome(reply, .dispatched, invalidated: Self.staleAfter(reply, record))
    case .select(let locator, let option):
      try onSite(record, binding)
      arguments["ref"] = .string(try element(locator, in: record, context: context))
      arguments["observationVersion"] = .int(record.version)
      arguments["label"] = .string(option)
      let reply = try await run(write, "select", arguments, context: context)
      return write.outcome(
        reply, reply.verified == true ? .verified : .dispatched,
        invalidated: Self.staleAfter(reply, record))
    case .upload(let locator, let resourceIds, let paths):
      try onSite(record, binding)
      let files: [String]
      do throws(BrowserFileScope.Refusal) {
        files = try BrowserFileScope.uploadFiles(paths, resourceIds: resourceIds, root: uploadRoot)
      } catch {
        throw ComputerFailure(.unsupported, error.message)
      }
      arguments["ref"] = .string(try element(locator, in: record, context: context))
      arguments["observationVersion"] = .int(record.version)
      arguments["paths"] = .array(files.map(Value.string))
      let reply = try await run(write, "upload", arguments, context: context)
      return write.outcome(reply, .dispatched, invalidated: Self.staleAfter(reply, record))
    case .wait, .setValue, .click, .type, .menu, .drag:
      throw ComputerFailure(
        .unsupported, "The browser engine cannot perform a \(step.kind.rawValue) step.")
    }
  }

  /// A worker condition for `condition` on `pageId`; element locators resolve against `record`,
  /// whose worker generation the call must then be pinned to. `newText` compares against the
  /// page text a `press` on that page captured just before its click, or else the observation's.
  func condition(
    _ condition: ComputerConditionWire, refId: String, pageId: String, record: ObservationRecord?,
    unattended: Bool
  ) throws(ComputerFailure) -> Value {
    let elementRef = { (locator: ComputerLocatorWire) throws(ComputerFailure) -> Value in
      guard let record else {
        throw ComputerFailure(
          .staleObservation, "The condition names an element; observe the target first.")
      }
      return .string(try self.element(locator, in: record, unattended: unattended))
    }
    switch condition {
    case .enabled(let locator):
      return .object(["kind": .string("enabled"), "ref": try elementRef(locator)])
    case .valueEquals(let locator, let text):
      return .object([
        "kind": .string("valueEquals"), "ref": try elementRef(locator), "text": .string(text),
      ])
    case .textAppears(let text):
      return .object(["kind": .string("textAppears"), "text": .string(text)])
    case .menuItemAvailable:
      throw ComputerFailure(.unsupported, "Application menus are not browser page state.")
    case .urlMatches(let pattern):
      return .object(["kind": .string("urlMatches"), "pattern": .string(pattern)])
    case .newText(let locator, let pattern, let region):
      guard region == nil else {
        throw ComputerFailure(.unsupported, "Regional verification is not browser page state.")
      }
      guard let baseline = pressBaselines[Self.baselineKey(refId, pageId)] ?? record?.baselineId
      else {
        throw ComputerFailure(
          .staleObservation, "There is no page text to compare with; observe the target first.")
      }
      var members: [String: Value] = [
        "kind": .string("newText"), "baselineId": .string(baseline),
      ]
      if let locator { members["ref"] = try elementRef(locator) }
      if let pattern { members["pattern"] = .string(pattern) }
      return .object(members)
    }
  }

  // MARK: Helpers

  /// What a page-changing call needs besides its arguments.
  struct Write {
    let instance: ManagedChromeInstance
    let record: ObservationRecord
    let downloads: URL
    /// The channel the step's input takes (``PlaywrightBrowserEngine/route(of:)``).
    let route: ActionResultWire.Route?

    /// The step's outcome with the downloads the reply reported. Every browser step is in the
    /// background, and the worker gives no per-input receipt.
    func outcome(
      _ reply: BrowserWorkerReply, _ outcome: ActionResultFold.StepOutcome,
      evidence: [ComputerEvidenceWire]? = nil, invalidated: String? = nil
    ) -> EngineStepOutcome {
      var result = EngineStepOutcome(
        outcome, evidence: evidence ?? reply.evidenceWire, invalidated: invalidated,
        delivery: .background, route: route)
      result.downloads = PlaywrightBrowserEngine.downloads(reply, in: downloads)
      return result
    }
  }

  static let imagePoint = ComputerFailure(
    .unsupported, "The browser engine names elements by ref or semantically, not by image point.")

  /// Replaces a text field's value (`clear` with no text), reading it back from the same node.
  private func fill(
    _ locator: ComputerLocatorWire, _ text: String, _ write: Write,
    _ binding: TargetBindingWire.Browser, _ base: [String: Value], context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    try onSite(write.record, binding)
    var arguments = base
    arguments["ref"] = .string(try element(locator, in: write.record, context: context))
    arguments["text"] = .string(text)
    if context.typing.typing || context.typing.animation {
      arguments["feedback"] = context.typing.browserFeedback(text)
    }
    arguments["observationVersion"] = .int(write.record.version)
    let reply = try await run(write, "fill", arguments, context: context)
    return write.outcome(
      reply, reply.verified == true ? .verified : .dispatched,
      invalidated: Self.staleAfter(reply, write.record))
  }

  /// Calls a page-changing tool, pinned to the observation's worker, and returns its successful
  /// reply. The worker's `notFound` names the page or something within it (a `select` option):
  /// it counts as the page closing only when the page is really gone.
  private func run(
    _ write: Write, _ tool: String, _ arguments: [String: Value], context: EngineStepContext
  ) async throws(ComputerFailure) -> BrowserWorkerReply {
    context.report(.dispatching(nil))
    let (reply, _) = try await call(
      write.instance, tool, arguments, timeout: .seconds(tool == "navigate" ? 20 : 15),
      writes: true, pinned: write.record.workerGeneration)
    do {
      return try checked(reply, tool)
    } catch {
      guard error.code == .targetChanged, !error.mayHaveDispatched,
        let pages = try? await listPages(write.instance),
        pages.contains(where: { $0.pageId == write.record.pageId })
      else { throw error }
      throw ComputerFailure(.notFound, error.message)
    }
  }

  private func element(
    _ locator: ComputerLocatorWire, in record: ObservationRecord, context: EngineStepContext
  ) throws(ComputerFailure) -> String {
    let ref = try element(locator, in: record, unattended: context.unattended)
    context.report(.located(.unavailable))
    return ref
  }

  /// The one element `locator` names. Unattended steps come from an approved recipe and must
  /// name elements by role and accessible name, never by an observation ref.
  private func element(
    _ locator: ComputerLocatorWire, in record: ObservationRecord, unattended: Bool
  ) throws(ComputerFailure) -> String {
    if unattended, case .ref = locator {
      throw ComputerFailure(
        .unsupported, "Unattended steps name elements by role and name, not by observation ref.")
    }
    let resolution = LocatorResolution.resolve(locator, in: record.elements)
    if case .found(let ref) = resolution { return ref }
    let failure = resolution.failure ?? ComputerErrorWire(code: .notFound, message: "")
    throw ComputerFailure(failure.code, failure.message)
  }

  /// Writes go only to a page on the binding's sites, as the observation saw it.
  private func onSite(_ record: ObservationRecord, _ binding: TargetBindingWire.Browser)
    throws(ComputerFailure)
  {
    guard let url = record.url, BrowserOrigins.allows(url, origins: binding.allowedOrigins)
    else {
      throw ComputerFailure(
        .unsupported, "The page is outside the target's allowed sites; navigate back first.")
    }
  }

  /// `observation` when the step changed what the observation lists (a navigation, rebuilt
  /// elements), so the host asks for a new one before the next action.
  private static func staleAfter(_ reply: BrowserWorkerReply, _ record: ObservationRecord)
    -> String?
  {
    guard let version = reply.observationVersion, version != record.version else { return nil }
    return "observation"
  }
}
