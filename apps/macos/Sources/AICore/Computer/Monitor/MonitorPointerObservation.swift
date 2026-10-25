import CoreGraphics

/// Where the host observed an operation's target, as the monitor needs it: the target in Quartz
/// global points and the window it is in, taken from the host's progress geometry before any
/// visibility check. The real-screen pointer marks only a target that is on screen and not
/// covered (`PointerFrame.targetRect` is nil otherwise), but the monitor also shows windows that
/// are covered or off screen, so it takes the observation itself.
///
/// Only native `screen` geometry has one. A page's viewport position (browser sources) is not
/// drawn in the monitor.
public struct MonitorPointerObservation: Equatable, Sendable {
  /// The target, not cut to its window.
  public let rect: CGRect
  /// The window the target is in: the target reference's root window.
  public let windowId: Int

  public init(rect: CGRect, windowId: Int) {
    self.rect = rect
    self.windowId = windowId
  }

  /// The observation behind a progress step, nil when its geometry is not a screen position or
  /// its target has no window.
  public init?(geometry: ComputerGeometryWire?, ref: TargetRefWire) {
    guard case .screen(_, let rect)? = geometry, let windowId = ref.native?.windowId else {
      return nil
    }
    self.init(rect: rect.cgRect, windowId: windowId)
  }
}
