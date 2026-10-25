import AICore

/// A shared reason vocabulary for native presentation and read-only model snapshots.
typealias PreviewReason = ScreenShareReplyWire.Unavailable

extension ComputerPreviewCoordinator {
  static func reason(_ error: any Error) -> PreviewReason {
    guard let failure = error as? ComputerFailure else { return .captureFailed }
    switch failure.code {
    case .needsPermission: return .permission
    case .locked: return .locked
    case .hostUnavailable: return .disconnected
    case .targetChanged, .targetUnavailable, .staleObservation: return .targetUnavailable
    default: return .captureFailed
    }
  }
}
