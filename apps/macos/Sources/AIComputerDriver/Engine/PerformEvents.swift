import AIComputerDriverKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// The window-routed event primitives (pointer, scroll, keys, text, drag). These need the
/// `windowEvents` capability; the ones that click or type also need a confirmed key scope, which
/// the driver refuses to open when the host reports the user typed within the guard window
/// (`userTyping`), so a keystroke can never land in the wrong app (plan I2).
enum PerformEvents {
  static func pointer(_ ctx: PerformContext, point: DriverPoint, clickCount: Int) throws
    -> DriverReceipt
  {
    try PerformHandler.ensure(.pointer, ctx)
    try requireWindowEvents()
    let resolved = try resolve(ctx)
    let toolkit = ToolkitProbe.classify(pid: ctx.pid, window: resolved.window).toolkit
    try requireDeliverableToolkit(toolkit)
    let target = PointerTarget(
      pid: ctx.pid, windowId: ctx.windowId, windowBounds: resolved.bounds, screenPoint: cg(point))
    let before = WindowServerQueries.frontProcessPID()
    // A mouse-down reaches a window's content only while the window is key (AppKit and Chromium
    // alike), so every click runs inside a target-only key scope.
    try requireKeyScope(ctx)
    let keyScope = try WindowKeyScope.run(targetPid: ctx.pid, targetWindowId: ctx.windowId) {
      guard PointerRecipes.click(factory: ctx.factory, target: target, clickCount: clickCount)
      else { throw DriverFailure(code: .noRoute, message: "could not build click events") }
    }
    return DriverReceipt(
      route: .pointer, dispatched: true, keyScope: keyScope,
      frontmost: PerformHandler.frontmostCheck(ctx, before: before))
  }

  static func scroll(
    _ ctx: PerformContext, point: DriverPoint, deltaX: Double, deltaY: Double
  ) throws -> DriverReceipt {
    try PerformHandler.ensure(.scroll, ctx)
    try requireWindowEvents()
    let resolved = try resolve(ctx)
    try requireDeliverableToolkit(
      ToolkitProbe.classify(pid: ctx.pid, window: resolved.window).toolkit)
    let target = PointerTarget(
      pid: ctx.pid, windowId: ctx.windowId, windowBounds: resolved.bounds, screenPoint: cg(point))
    guard ScrollRecipes.scroll(factory: ctx.factory, target: target, deltaX: deltaX, deltaY: deltaY)
    else { throw DriverFailure(code: .noRoute, message: "could not build scroll event") }
    return DriverReceipt(
      route: .scroll, dispatched: true, frontmost: PerformHandler.frontmostCheck(ctx, before: nil))
  }

  static func keys(_ ctx: PerformContext, chord specification: String) throws -> DriverReceipt {
    try PerformHandler.ensure(.keys, ctx)
    try requireWindowEvents()
    try requireNoSecureInput()
    try requireKeyScope(ctx)
    let chord = try KeyMapping.parse(specification)
    let report = try WindowKeyScope.run(targetPid: ctx.pid, targetWindowId: ctx.windowId) {
      _ = KeyboardRecipes.pressChord(factory: ctx.factory, chord: chord, pid: ctx.pid)
    }
    return DriverReceipt(
      route: .keys, dispatched: true, keyScope: report,
      frontmost: PerformHandler.frontmostCheck(ctx, before: nil))
  }

  static func text(_ ctx: PerformContext, text: String) throws -> DriverReceipt {
    try PerformHandler.ensure(.text, ctx)
    try requireWindowEvents()
    try requireNoSecureInput()
    try requireKeyScope(ctx)
    let report = try WindowKeyScope.run(targetPid: ctx.pid, targetWindowId: ctx.windowId) {
      _ = KeyboardRecipes.typeText(factory: ctx.factory, text: text, pid: ctx.pid)
    }
    return DriverReceipt(
      route: .text, dispatched: true, keyScope: report,
      frontmost: PerformHandler.frontmostCheck(ctx, before: nil))
  }

  static func drag(_ ctx: PerformContext, from: DriverPoint, to: DriverPoint) throws
    -> DriverReceipt
  {
    try PerformHandler.ensure(.drag, ctx)
    try requireWindowEvents()
    let resolved = try resolve(ctx)
    try requireDeliverableToolkit(
      ToolkitProbe.classify(pid: ctx.pid, window: resolved.window).toolkit)
    try DragRecipes.drag(
      factory: ctx.factory, pid: ctx.pid, windowId: ctx.windowId, windowBounds: resolved.bounds,
      from: cg(from), to: cg(to))
    return DriverReceipt(
      route: .drag, dispatched: true, frontmost: PerformHandler.frontmostCheck(ctx, before: nil))
  }

  // MARK: - Helpers

  private static func cg(_ point: DriverPoint) -> CGPoint { CGPoint(x: point.x, y: point.y) }

  private static func resolve(_ ctx: PerformContext) throws -> WindowResolver.Resolved {
    guard let resolved = WindowResolver.resolve(ctx.request.target) else {
      throw DriverFailure(code: .targetGone)
    }
    return resolved
  }

  /// A window-routed event only reaches a toolkit that honors the delivered window-local point.
  /// An opaque Metal/GL/no-AX surface drops background synthetic input, and Java/AWT (and similar)
  /// recompute the hit from the real pointer, so a click would land wherever the user's cursor is.
  /// Refuse both here (plan §2.1) rather than post an event that does nothing or hits the wrong
  /// place; the host maps these to `opaqueSurface` / `pointerToolkit`.
  private static func requireDeliverableToolkit(_ toolkit: DriverToolkit) throws {
    switch toolkit {
    case .opaque:
      throw DriverFailure(
        code: .opaqueSurface,
        message: "opaque surface (no usable AX subtree); background input dropped")
    case .java:
      throw DriverFailure(
        code: .pointerToolkit,
        message: "toolkit reads the real pointer; window-routed click would misland")
    default:
      return
    }
  }

  /// Synthetic keyboard delivery is impossible while secure input is held anywhere in the session
  /// (password fields, the lock screen, many sheets): the OS routes keys only to the enabling
  /// process. Detect and refuse rather than post keys that are silently swallowed (plan §2.1).
  private static func requireNoSecureInput() throws {
    if IsSecureEventInputEnabled() {
      throw DriverFailure(
        code: .secureInput, message: "secure event input is enabled; synthetic keys are blocked")
    }
  }

  private static func requireWindowEvents() throws {
    guard PrivateSymbols.shared.capability(DriverCapabilityName.windowEvents).available else {
      throw DriverFailure(code: .capabilityUnavailable, message: "window events unavailable")
    }
  }

  /// Guard a key scope: the capability must be present AND the host must not have reported the
  /// user typing within the guard window.
  private static func requireKeyScope(_ ctx: PerformContext) throws {
    guard PrivateSymbols.shared.capability(DriverCapabilityName.keyScope).available else {
      throw DriverFailure(code: .capabilityUnavailable, message: "key scope unavailable")
    }
    if ctx.request.userTypedWithinGuard {
      throw DriverFailure(
        code: .userTyping, message: "user typed within the guard window; key scope refused")
    }
  }
}
