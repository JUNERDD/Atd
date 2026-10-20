import AICore
import AppKit
import Carbon.HIToolbox
import CoreGraphics

/// The live system state the coordinator checks before and between steps (plan §4.2, §6.2,
/// §6.3, §8.3): privacy grants, the lock screen and secure input, and whether a target's rect may
/// be drawn on screen. Read each time, never cached. Whether the person is using a target is the
/// engine's to say (``ComputerEngine/isInUse(_:)``).
enum ComputerScreenState {
  /// The grant a request lacks, checked live: Accessibility for a native target, through which
  /// the driver (a child process with Atd's grants) reads and acts; Screen Recording for a
  /// screenshot. A run never asks the system for a grant (plan I7): granting happens in Settings,
  /// whose own buttons ask. Whether window-routed input can be posted is the native engine's to
  /// check before it takes that route.
  static func missingPermission(kind: ComputerTargetKind, screenshot: Bool) -> ComputerFailure? {
    if kind == .native, !SelectionReader.isTrusted {
      return ComputerFailure(.needsPermission, "Atd is not granted the Accessibility permission.")
    }
    if screenshot, !CGPreflightScreenCaptureAccess() {
      return ComputerFailure(
        .needsPermission, "Atd is not granted the Screen & System Audio Recording permission.")
    }
    return nil
  }

  /// Whether window-routed input can reach native apps: the event-posting grant, which macOS
  /// lists under Accessibility. Settings shows it from `computer.state`.
  static var canPostEvents: Bool { CGPreflightPostEventAccess() }

  /// Why writes may not start now: the screen is locked, or an app holds secure input (a
  /// password field), during which no write is admitted (plan §6.2, interactive screen).
  static func writeBlock() -> ComputerFailure? {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    if (session?["CGSSessionScreenIsLocked"] as? Bool) == true {
      return ComputerFailure(.busy, "The screen is locked; writes wait until it is unlocked.")
    }
    if IsSecureEventInputEnabled() {
      return ComputerFailure(
        .busy, "Another app is reading a password (secure input is on); try again later.")
    }
    return nil
  }

  /// The screen rect the live pointer may draw for `geometry`, in Quartz global points: only
  /// verified screen coordinates of a native window that is on screen and not covered there by
  /// another app's window. Anything else is nil, which clears the mark.
  struct PointerPlacement: Equatable {
    let rect: CGRect
    let windowFrame: CGRect
  }

  static func pointerPlacement(_ geometry: ComputerGeometryWire?, ref: TargetRefWire)
    -> PointerPlacement?
  {
    guard case .screen(_, let rect)? = geometry, let windowId = ref.native?.windowId else {
      return nil
    }
    let target = rect.cgRect
    guard let window = windows(.optionIncludingWindow, relativeTo: windowId).first,
      (window[kCGWindowIsOnscreen as String] as? Bool) == true,
      let frame = bounds(of: window), frame.intersects(target)
    else { return nil }
    let center = CGPoint(x: target.midX, y: target.midY)
    let own = ProcessInfo.processInfo.processIdentifier
    let covered = windows(.optionOnScreenAboveWindow, relativeTo: windowId).contains { info in
      (info[kCGWindowLayer as String] as? Int) == 0
        && (info[kCGWindowOwnerPID as String] as? pid_t) != own
        && bounds(of: info)?.contains(center) == true
    }
    return covered ? nil : PointerPlacement(rect: target.intersection(frame), windowFrame: frame)
  }

  private static func windows(_ option: CGWindowListOption, relativeTo window: Int)
    -> [[String: Any]]
  {
    (CGWindowListCopyWindowInfo(option, CGWindowID(clamping: window)) as? [[String: Any]]) ?? []
  }

  private static func bounds(of window: [String: Any]) -> CGRect? {
    guard let dictionary = window[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: dictionary as CFDictionary)
  }
}
