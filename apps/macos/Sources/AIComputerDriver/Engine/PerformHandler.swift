import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Shared state for one `perform`, carried through the primitive handlers. All of these run on
/// the target pid's serial executor.
struct PerformContext {
  let request: DriverPerformRequest
  let factory: EventFactory
  let store: AXElementStore
  let executors: TargetExecutors
  var pid: pid_t { pid_t(request.target.pid) }
  var windowId: CGWindowID { CGWindowID(request.target.windowId) }
}

/// Executes one background primitive and returns a receipt, or a `DriverFailure`. The route ladder
/// itself lives in the host; the driver delivers exactly the primitive it is handed, refusing
/// (never upgrading) when its route is not permitted or its capability is unavailable (plan I5).
enum PerformHandler {
  static func perform(_ ctx: PerformContext) -> Result<DriverReceipt, DriverFailure> {
    let start = Date()
    let front = WindowServerQueries.frontProcessPID()
    do {
      var stamped = try dispatch(ctx)
      stamped.frontmost = frontmostCheck(ctx, before: front)
      stamped.elapsedMilliseconds = Date().timeIntervalSince(start) * 1000
      return .success(stamped)
    } catch let failure as DriverFailure {
      return .failure(failure)
    } catch {
      return .failure(DriverFailure(code: .internalError, message: String(describing: error)))
    }
  }

  private static func dispatch(_ ctx: PerformContext) throws -> DriverReceipt {
    switch ctx.request.primitive {
    case .axAction(let element, let action):
      return try axAction(ctx, element: element, action: action)
    case .axSetValue(let element, let value):
      try ensure(.axText, ctx)
      try withElement(ctx, element) { try AXActions.setValue($0, value) }
      return DriverReceipt(route: .axText, dispatched: true)
    case .axInsertText(let element, let text, let range):
      try ensure(.axText, ctx)
      try withElement(ctx, element) { try AXTextWriter.insert($0, text: text, range: range) }
      return DriverReceipt(route: .axText, dispatched: true)
    case .axFocus(let element):
      try ensure(.axAction, ctx)
      try withElement(ctx, element) { try AXActions.focus($0) }
      return DriverReceipt(route: .axAction, dispatched: true)
    case .axMenu(let path):
      return try axMenu(ctx, path: path)
    case .axScroll(let element, let kind):
      return try axScroll(ctx, element: element, kind: kind)
    case .pointer(let point, let clickCount):
      return try PerformEvents.pointer(ctx, point: point, clickCount: clickCount)
    case .scroll(let point, let deltaX, let deltaY):
      return try PerformEvents.scroll(ctx, point: point, deltaX: deltaX, deltaY: deltaY)
    case .keys(let chord):
      return try PerformEvents.keys(ctx, chord: chord)
    case .text(let text):
      return try PerformEvents.text(ctx, text: text)
    case .drag(let from, let to):
      return try PerformEvents.drag(ctx, from: from, to: to)
    }
  }

  // MARK: - AX primitives

  /// AX actions can open UI (press/pick/showAlternateUI), which the messaging timeout does not
  /// bound, so they run on an abandonable worker raced against the request deadline.
  private static func axAction(
    _ ctx: PerformContext, element token: String, action: DriverAXActionKind
  ) throws -> DriverReceipt {
    try ensure(.axAction, ctx)
    let element = try element(ctx, token)
    let box = UncheckedBox(element)
    let outcome = ctx.executors.runAbandonable(
      pid: ctx.pid, deadlineMilliseconds: ctx.request.deadlineMilliseconds
    ) { () -> DriverFailure? in
      do {
        try AXActions.perform(box.value, action)
        return nil
      } catch let failure as DriverFailure {
        return failure
      } catch {
        return DriverFailure(code: .internalError, message: String(describing: error))
      }
    }
    switch outcome {
    case .completed(let failure):
      if let failure { throw failure }
      return DriverReceipt(route: .axAction, dispatched: true)
    case .timedOut:
      throw DriverFailure(
        code: .cancelled, message: "AX action exceeded the deadline and is still running",
        mayHaveDispatched: true)
    }
  }

  private static func axMenu(_ ctx: PerformContext, path: [String]) throws -> DriverReceipt {
    try ensure(.axMenu, ctx)
    guard let resolved = WindowResolver.resolve(ctx.request.target) else {
      throw DriverFailure(code: .targetGone)
    }
    let box = UncheckedBox(resolved.app)
    let outcome = ctx.executors.runAbandonable(
      pid: ctx.pid, deadlineMilliseconds: ctx.request.deadlineMilliseconds
    ) { () -> DriverFailure? in
      do {
        try AXMenuResolver.press(appElement: box.value, path: path)
        return nil
      } catch let failure as DriverFailure {
        return failure
      } catch {
        return DriverFailure(code: .internalError, message: String(describing: error))
      }
    }
    switch outcome {
    case .completed(let failure):
      if let failure { throw failure }
      return DriverReceipt(route: .axMenu, dispatched: true)
    case .timedOut:
      throw DriverFailure(
        code: .cancelled, message: "menu press exceeded the deadline", mayHaveDispatched: true)
    }
  }

  private static func axScroll(
    _ ctx: PerformContext, element token: String?, kind: DriverScrollKind
  ) throws -> DriverReceipt {
    try ensure(.axScroll, ctx)
    let element: AXUIElement
    if let token {
      element = try self.element(ctx, token)
    } else if let resolved = WindowResolver.resolve(ctx.request.target) {
      element = resolved.window
    } else {
      throw DriverFailure(code: .targetGone)
    }
    try AXScroll.scroll(element, kind)
    return DriverReceipt(route: .axScroll, dispatched: true)
  }

  // MARK: - Shared helpers

  static func element(_ ctx: PerformContext, _ token: String) throws -> AXUIElement {
    guard let element = ctx.store.element(forToken: token) else {
      throw DriverFailure(
        code: .staleElement, message: "element token \(token) is stale or unknown")
    }
    return element
  }

  private static func withElement(
    _ ctx: PerformContext, _ token: String, _ body: (AXUIElement) throws -> Void
  ) throws {
    try body(element(ctx, token))
  }

  /// Fail when the primitive's route is not in the host's permitted set (empty means the
  /// primitive's natural route is allowed).
  static func ensure(_ route: DriverRoute, _ ctx: PerformContext) throws {
    let allow = ctx.request.routeAllow
    guard allow.isEmpty || allow.contains(route) else {
      throw DriverFailure(code: .noRoute, message: "route \(route.rawValue) not permitted by host")
    }
  }

  /// The frontmost app around the primitive, read before it starts: the driver never intends to
  /// change it, so a target that became frontmost during the primitive is a disturbance the host
  /// attributes to the agent, while one the person already had in front is not.
  private static func frontmostCheck(_ ctx: PerformContext, before: pid_t?)
    -> DriverFrontmostCheck
  {
    let after = WindowServerQueries.frontProcessPID()
    let raised = after == ctx.pid && before != ctx.pid
    return DriverFrontmostCheck(
      frontmostPidBefore: before.map(Int.init), frontmostPidAfter: after.map(Int.init),
      targetRaised: raised)
  }
}
