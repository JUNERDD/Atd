import Foundation

/// Host, placement, signing, TCC permission, display, and proxy snapshot (`environment.json`,
/// `04-privacy-redaction-and-bundle.md` §1.3).
///
/// Note (`AGENTS.md:129`): `operatingSystemVersionString` is a strictly passive human-readable
/// diagnostic field; no code path may parse or branch on it.
public struct DiagnosticsEnvironmentRecord: Codable, Equatable, Sendable {
  public struct AppIdentityRecord: Codable, Equatable, Sendable {
    public let bundleIdentifier: String
    public let shortVersion: String
    public let buildVersion: String
    public let isDevelopment: Bool
    public let updaterConfigured: Bool
    public let customFeedOverrideSet: Bool

    public init(
      bundleIdentifier: String,
      shortVersion: String,
      buildVersion: String,
      isDevelopment: Bool,
      updaterConfigured: Bool,
      customFeedOverrideSet: Bool
    ) {
      self.bundleIdentifier = bundleIdentifier
      self.shortVersion = shortVersion
      self.buildVersion = buildVersion
      self.isDevelopment = isDevelopment
      self.updaterConfigured = updaterConfigured
      self.customFeedOverrideSet = customFeedOverrideSet
    }
  }

  public struct HostHardwareRecord: Codable, Equatable, Sendable {
    public let arch: String
    public let isRosettaTranslated: Bool
    public let rosettaRuntimePresent: Bool
    /// Passive diagnostic metadata only (`AGENTS.md:129`); never branch on this string.
    public let operatingSystemVersionString: String
    public let processorCount: Int
    public let physicalMemoryGiB: Int
    public let dataVolumeFreeBytes: Int64?

    public init(
      arch: String,
      isRosettaTranslated: Bool,
      rosettaRuntimePresent: Bool,
      operatingSystemVersionString: String,
      processorCount: Int,
      physicalMemoryGiB: Int,
      dataVolumeFreeBytes: Int64?
    ) {
      self.arch = arch
      self.isRosettaTranslated = isRosettaTranslated
      self.rosettaRuntimePresent = rosettaRuntimePresent
      self.operatingSystemVersionString = operatingSystemVersionString
      self.processorCount = processorCount
      self.physicalMemoryGiB = physicalMemoryGiB
      self.dataVolumeFreeBytes = dataVolumeFreeBytes
    }
  }

  public struct BundlePlacementRecord: Codable, Equatable, Sendable {
    public let locationCategory: String
    public let isTranslocated: Bool
    public let isReadOnlyMount: Bool
    public let hasQuarantineAttribute: Bool
    public let widgetsIndexedLocation: Bool
    public let runningNodeInsideAppBundle: Bool?

    public init(
      locationCategory: String,
      isTranslocated: Bool,
      isReadOnlyMount: Bool,
      hasQuarantineAttribute: Bool,
      widgetsIndexedLocation: Bool,
      runningNodeInsideAppBundle: Bool?
    ) {
      self.locationCategory = locationCategory
      self.isTranslocated = isTranslocated
      self.isReadOnlyMount = isReadOnlyMount
      self.hasQuarantineAttribute = hasQuarantineAttribute
      self.widgetsIndexedLocation = widgetsIndexedLocation
      self.runningNodeInsideAppBundle = runningNodeInsideAppBundle
    }

    /// Pure string-prefix placement classifier (Folder-TCC safe: never stats `~/Downloads` or
    /// enumerates parent directories).
    public static func classifyLocation(
      bundlePath: String,
      homePath: String = FileManager.default.homeDirectoryForCurrentUser.path(
        percentEncoded: false),
      isTranslocated: Bool = false
    ) -> String {
      if isTranslocated || bundlePath.contains("/AppTranslocation/") {
        return "app_translocation"
      }
      if bundlePath.hasPrefix("/Applications/") {
        return "system_applications"
      }
      let trimmedHome = homePath.hasSuffix("/") ? String(homePath.dropLast()) : homePath
      if !trimmedHome.isEmpty && bundlePath.hasPrefix(trimmedHome + "/Applications/") {
        return "user_applications"
      }
      if bundlePath.hasPrefix("/Volumes/") {
        return "volumes_dmg"
      }
      if !trimmedHome.isEmpty && bundlePath.hasPrefix(trimmedHome + "/Downloads/") {
        return "downloads"
      }
      return "other"
    }
  }

  public struct SigningHealthRecord: Codable, Equatable, Sendable {
    public let designatedRequirementReadable: Bool
    public let requirementMatchesStored: Bool?

    public init(designatedRequirementReadable: Bool, requirementMatchesStored: Bool?) {
      self.designatedRequirementReadable = designatedRequirementReadable
      self.requirementMatchesStored = requirementMatchesStored
    }
  }

  public struct PermissionSnapshotRecord: Codable, Equatable, Sendable {
    public let accessibilityTrusted: Bool
    public let duplicateAppBundlesCount: Int
    public let screenRecordingTrusted: Bool
    public let listenEventTrusted: Bool
    public let postEventTrusted: Bool
    public let secureEventInputEnabled: Bool

    public init(
      accessibilityTrusted: Bool,
      duplicateAppBundlesCount: Int,
      screenRecordingTrusted: Bool,
      listenEventTrusted: Bool,
      postEventTrusted: Bool,
      secureEventInputEnabled: Bool
    ) {
      self.accessibilityTrusted = accessibilityTrusted
      self.duplicateAppBundlesCount = duplicateAppBundlesCount
      self.screenRecordingTrusted = screenRecordingTrusted
      self.listenEventTrusted = listenEventTrusted
      self.postEventTrusted = postEventTrusted
      self.secureEventInputEnabled = secureEventInputEnabled
    }
  }

  public struct SelectionToolbarSnapshotRecord: Codable, Equatable, Sendable {
    public let settingsReceived: Bool
    public let enabled: Bool
    public let activationMode: String?
    public let toggleListeningOn: Bool?
    public let monitorInstalled: Bool
    public let excludedAppCount: Int

    public init(
      settingsReceived: Bool,
      enabled: Bool,
      activationMode: String?,
      toggleListeningOn: Bool?,
      monitorInstalled: Bool,
      excludedAppCount: Int
    ) {
      self.settingsReceived = settingsReceived
      self.enabled = enabled
      self.activationMode = activationMode
      self.toggleListeningOn = toggleListeningOn
      self.monitorInstalled = monitorInstalled
      self.excludedAppCount = excludedAppCount
    }
  }

  public struct DisplayGeometryRecord: Codable, Equatable, Sendable {
    public let index: Int
    public let widthPoints: Int
    public let heightPoints: Int
    public let backingScaleFactor: Double
    public let isBuiltin: Bool
    public let sdrSnapshotSupported: Bool

    public init(
      index: Int,
      widthPoints: Int,
      heightPoints: Int,
      backingScaleFactor: Double,
      isBuiltin: Bool,
      sdrSnapshotSupported: Bool
    ) {
      self.index = index
      self.widthPoints = widthPoints
      self.heightPoints = heightPoints
      self.backingScaleFactor = backingScaleFactor
      self.isBuiltin = isBuiltin
      self.sdrSnapshotSupported = sdrSnapshotSupported
    }
  }

  public struct SystemProxyFlagsRecord: Codable, Equatable, Sendable {
    public let pacEnabled: Bool
    public let wpadEnabled: Bool
    public let httpProxyEnabled: Bool
    public let httpsProxyEnabled: Bool
    public let socksProxyEnabled: Bool

    public init(
      pacEnabled: Bool,
      wpadEnabled: Bool,
      httpProxyEnabled: Bool,
      httpsProxyEnabled: Bool,
      socksProxyEnabled: Bool
    ) {
      self.pacEnabled = pacEnabled
      self.wpadEnabled = wpadEnabled
      self.httpProxyEnabled = httpProxyEnabled
      self.httpsProxyEnabled = httpsProxyEnabled
      self.socksProxyEnabled = socksProxyEnabled
    }
  }

  public struct EnterpriseCaSnapshotRecord: Codable, Equatable, Sendable {
    public let customAdminRootCertCount: Int

    public init(customAdminRootCertCount: Int) {
      self.customAdminRootCertCount = customAdminRootCertCount
    }
  }

  public let schemaVersion: Int
  public let capturedAt: String
  public let app: AppIdentityRecord
  public let host: HostHardwareRecord
  public let placement: BundlePlacementRecord
  public let signing: SigningHealthRecord
  public let permissions: PermissionSnapshotRecord
  public let selectionToolbar: SelectionToolbarSnapshotRecord
  public let displays: [DisplayGeometryRecord]
  public let systemProxyFlags: SystemProxyFlagsRecord
  public let enterpriseCa: EnterpriseCaSnapshotRecord

  public init(
    schemaVersion: Int = 1,
    capturedAt: String,
    app: AppIdentityRecord,
    host: HostHardwareRecord,
    placement: BundlePlacementRecord,
    signing: SigningHealthRecord,
    permissions: PermissionSnapshotRecord,
    selectionToolbar: SelectionToolbarSnapshotRecord,
    displays: [DisplayGeometryRecord],
    systemProxyFlags: SystemProxyFlagsRecord,
    enterpriseCa: EnterpriseCaSnapshotRecord
  ) {
    self.schemaVersion = schemaVersion
    self.capturedAt = capturedAt
    self.app = app
    self.host = host
    self.placement = placement
    self.signing = signing
    self.permissions = permissions
    self.selectionToolbar = selectionToolbar
    self.displays = displays
    self.systemProxyFlags = systemProxyFlags
    self.enterpriseCa = enterpriseCa
  }
}
