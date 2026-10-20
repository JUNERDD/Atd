import Foundation

/// The closed set of reasons the driver refuses or fails a primitive. The host maps these onto
/// its own `ComputerErrorCode` plus a reason; the driver never invents a visible fallback. These
/// mirror the plan's refusal reasons (§2.1/§4.2) so "prefer refusing over escalating" is
/// expressible end to end.
public enum DriverRefusalCode: String, Codable, Equatable, Sendable, CaseIterable {
  /// No background route produced the effect (AX action absent and events unavailable).
  case noRoute
  /// The toolkit reads the real pointer location, so a window-routed click lands at the physical
  /// cursor instead of the target (Java/AWT, some Qt). Refuse rather than click the wrong place.
  case pointerToolkit
  /// An opaque Metal/GL/game surface with no usable AX subtree; background input is dropped.
  case opaqueSurface
  /// Text cannot be written: AX value/selected-text not settable and no event route is open.
  case textUnavailable
  /// A key chord cannot be delivered: no menu equivalent and the event route is unavailable.
  case keyUnavailable
  /// A menu path could not be resolved or the leaf item was disabled in the background.
  case menuUnavailable
  /// Secure input is enabled somewhere in the session, so synthetic keys are blocked system-wide.
  case secureInput
  /// A native `NSDraggingSession` drag cannot complete in the background (tracks the real pointer).
  case dragAndDrop
  /// Most hover/tooltip reveals cannot be delivered to a background app.
  case hover
  /// The target window is minimized; the driver will not deminiaturize it.
  case minimized
  /// The target window is on another (inactive) Space; writes are refused there.
  case offSpace
  /// The target window is in a full-screen Space; writes are refused there.
  case fullScreen
  /// The caller reported the user typed within the key-return guard window, so the driver would
  /// not open a key scope. Imperceptibility takes priority over the action.
  case userTyping
  /// A required private symbol or behavioral self-test did not pass for this process.
  case capabilityUnavailable
  /// The element token is stale (its snapshot generation was invalidated) or unknown.
  case staleElement
  /// The targeted window or process no longer exists.
  case targetGone
  /// The request was cancelled, or its deadline elapsed, before the effect was confirmed.
  case cancelled
  /// The request payload was malformed for this protocol version.
  case badRequest
  /// An unexpected internal error; `message` carries detail for logs, never for the model.
  case internalError
}

/// The machine-readable result of a refused or failed primitive.
public struct DriverFailure: Codable, Equatable, Sendable, Error {
  public var code: DriverRefusalCode
  /// Operator-facing detail for logs and diagnostics; not meant for the model verbatim.
  public var message: String?
  /// True when the driver may already have dispatched the input before failing (a stuck AX
  /// action, a cancel mid-flight). The host must then STOP and not retry on another route: the
  /// effect is unknown, and replaying could double-apply it.
  public var mayHaveDispatched: Bool

  public init(code: DriverRefusalCode, message: String? = nil, mayHaveDispatched: Bool = false) {
    self.code = code
    self.message = message
    self.mayHaveDispatched = mayHaveDispatched
  }
}
