/// The native monitor's String Catalog keys, kept with their independently owned surface.
public enum ComputerMonitorStringKey: String, CaseIterable, Sendable {
  case computerMonitorTitle = "computerMonitor.title"
  /// One `%lld` argument, the number of sources, with plural variations.
  case computerMonitorSourceCount = "computerMonitor.sourceCount"
  case computerMonitorEmptyTitle = "computerMonitor.emptyTitle"
  case computerMonitorEmptyDetail = "computerMonitor.emptyDetail"
  case computerMonitorEnlarge = "computerMonitor.enlarge"
  case computerMonitorAllSources = "computerMonitor.allSources"
  case computerMonitorPreviousSource = "computerMonitor.previousSource"
  case computerMonitorNextSource = "computerMonitor.nextSource"
  case computerMonitorKeepOnTop = "computerMonitor.keepOnTop"
  /// The accessibility value of a tile whose frames are showing.
  case computerMonitorLive = "computerMonitor.live"
  case computerMonitorStarting = "computerMonitor.starting"
  case computerMonitorBlank = "computerMonitor.blank"
  case computerMonitorSuspended = "computerMonitor.suspended"
  case computerMonitorCaptureFailed = "computerMonitor.captureFailed"
  case computerMonitorLocked = "computerMonitor.locked"
  case computerMonitorLockedDetail = "computerMonitor.lockedDetail"
  case computerMonitorTargetUnavailable = "computerMonitor.targetUnavailable"
  case computerMonitorPermission = "computerMonitor.permission"
  case computerMonitorOpenPrivacySettings = "computerMonitor.openPrivacySettings"
  case computerMonitorDisconnected = "computerMonitor.disconnected"
  /// One format argument: the shared source's ordinal.
  case computerMonitorSharedSource = "computerMonitor.sharedSource"
}
