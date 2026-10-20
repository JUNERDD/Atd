import AICore
import AppKit

/// What Settings shows of the computer host (`computer.state`) and the settings it changes: the
/// host and its engines, previews, unsettled actions, the event-posting grant background input
/// needs, and whether the person prepared screen-capture consent (plan §8.3).
extension ComputerCoordinator {
  func stateEvent() -> ComputerStateEvent {
    let state: ComputerStateEvent.Host =
      !started
      ? .starting
      : stopping || host.failure != nil
        ? .unavailable
        : host.lock.isHeld && host.generation != nil ? .ready : .locked
    let unsettled = reviewable
    return ComputerStateEvent(
      host: state, pointerVisible: pointer.isEnabled, typing: typing.options.typing,
      typingAnimation: typing.options.animation, previews: previews.metadata,
      engines: engines.stateEvents,
      unsettled: .init(count: unsettled.count, actionIds: Array(unsettled.prefix(50))),
      captureConsent: captureConsent.record.map {
        ComputerStateEvent.CaptureConsent(bundleId: $0.bundleId, primedAt: $0.primedAt)
      },
      postEventAccess: ComputerScreenState.canPostEvents)
  }

  /// `computer.setPointerVisible`: display only; stopping work keeps its own entry points.
  func setPointerVisible(_ visible: Bool) {
    defaults.set(visible, forKey: Self.pointerVisibleKey)
    pointer.isEnabled = visible
    onStateChange?()
  }

  /// `computer.primeCaptureConsent`, from the person's click in Settings and nowhere else: the
  /// state goes out with the new record before the page hears the answer.
  func primeCaptureConsent() async -> ComputerPrimeCaptureConsentResult {
    guard !stopping else { return .unavailable(.init()) }
    switch await captureConsent.prime() {
    case .prepared(let primedAt):
      onStateChange?()
      return .prepared(.init(primedAt: primedAt))
    case .denied: return .denied(.init())
    case .unavailable: return .unavailable(.init())
    }
  }

  /// macOS sends no notice when the event-posting grant changes, so coming back to Atd, as from
  /// System Settings, publishes the state again; called once from ``start()``.
  func observeGrants() {
    grantObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.onStateChange?() }
    }
  }
}
