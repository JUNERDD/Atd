import AICore
import ApplicationServices
import CFNetwork
import Carbon.HIToolbox
import CoreGraphics
import CoreServices
import Darwin
import Foundation
import Security
import ServiceManagement

/// Off-main read-only host environment probes (`02-doctor-and-live-probes.md` §1.2 & §2).
///
/// Safety invariants:
/// - Explicitly `nonisolated` so `AIShell`'s default `@MainActor` isolation never runs `pluginkit`,
///   Security framework evaluations, or `statfs` on `CFRunLoopGetMain()`.
/// - Strictly obeys the Folder-TCC No-Touch Rule: NEVER stats or enumerates `~/Desktop`,
///   `~/Documents`, `~/Downloads`, `~/Library/Mobile Documents`, or parent directories of the app.
/// - Zero modal prompts: uses passive TCC preflights only (`AXIsProcessTrusted`,
///   `CGPreflightScreenCaptureAccess`, `CGPreflightListenEventAccess`,
///   `CGPreflightPostEventAccess`).
/// - Zero `ProcessInfo.operatingSystemVersion` branching (`AGENTS.md:129`): `operatingSystemVersionString`
///   is recorded solely as passive human-readable metadata in `environment.json`.
nonisolated enum ShellEnvironmentProbes {
  struct PlacementProbeResult: Sendable {
    let record: DiagnosticsEnvironmentRecord.BundlePlacementRecord
  }

  struct SignatureProbeResult: Sendable {
    let valid: Bool
    let isAdHoc: Bool
    let requirement: String?
    let record: DiagnosticsEnvironmentRecord.SigningHealthRecord
  }

  struct FinderSyncStatus: Sendable {
    enum State: String, Sendable {
      case enabled
      case disabled
      case undecided
      case absent
      case unavailable
    }
    let state: State
  }

  static func inspectPlacement(
    bundleURL: URL,
    homePath: String,
    widgetsIndexedLocation: Bool,
    runningNodePid: pid_t?,
    allowedExecutableRoot: URL?
  ) -> PlacementProbeResult {
    let rawPath = bundleURL.path(percentEncoded: false)
    let translocated = isBundleTranslocated(bundleURL, rawPath: rawPath)
    let category = DiagnosticsEnvironmentRecord.BundlePlacementRecord.classifyLocation(
      bundlePath: rawPath, homePath: homePath, isTranslocated: translocated)

    // Only query `statfs` and `getxattr` on the already dyld-mapped `bundleURL` itself (never
    // `~/Downloads` or any parent folder).
    var fs = statfs()
    let readOnlyMount =
      rawPath.withCString { cPath in statfs(cPath, &fs) == 0 }
      && (Int32(fs.f_flags) & MNT_RDONLY) != 0
    let quarantined =
      rawPath.withCString { cPath in
        getxattr(cPath, "com.apple.quarantine", nil, 0, 0, XATTR_NOFOLLOW) >= 0
      }

    let nodeInsideBundle: Bool? =
      if let pid = runningNodePid, let root = allowedExecutableRoot {
        ProcessIdentity.isProcess(pid, inside: root)
      } else {
        nil
      }

    return PlacementProbeResult(
      record: .init(
        locationCategory: category,
        isTranslocated: translocated,
        isReadOnlyMount: readOnlyMount,
        hasQuarantineAttribute: quarantined,
        widgetsIndexedLocation: widgetsIndexedLocation,
        runningNodeInsideAppBundle: nodeInsideBundle))
  }

  static func inspectSignature(storedRequirement: String?) -> SignatureProbeResult {
    var code: SecCode?
    var staticCode: SecStaticCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
      SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode
    else {
      return SignatureProbeResult(
        valid: false, isAdHoc: false, requirement: nil,
        record: .init(designatedRequirementReadable: false, requirementMatchesStored: nil))
    }

    let valid = SecStaticCodeCheckValidity(staticCode, [], nil) == errSecSuccess
    var reqRef: SecRequirement?
    var reqText: CFString?
    let readable =
      SecCodeCopyDesignatedRequirement(staticCode, [], &reqRef) == errSecSuccess
      && reqRef != nil
      && SecRequirementCopyString(reqRef!, [], &reqText) == errSecSuccess
      && reqText != nil

    let reqString = readable ? (reqText as String?) : nil
    let isAdHoc =
      reqString.map { $0.contains("cdhash") && !$0.contains("certificate") } ?? false
    let matchesStored =
      if let storedRequirement, let reqString {
        storedRequirement == reqString
      } else {
        nil as Bool?
      }

    return SignatureProbeResult(
      valid: valid,
      isAdHoc: isAdHoc,
      requirement: reqString,
      record: .init(
        designatedRequirementReadable: readable,
        requirementMatchesStored: matchesStored))
  }

  static func inspectHardware(dataDirectory: URL) -> (
    record: DiagnosticsEnvironmentRecord.HostHardwareRecord, arm64CapableHost: Bool
  ) {
    #if arch(arm64)
      let arch = "arm64"
    #else
      let arch = "x86_64"
    #endif

    let translated = sysctlInt32("sysctl.proc_translated") == 1
    let arm64Capable = sysctlInt32("hw.optional.arm64") == 1
    let rosettaPresent = FileManager.default.fileExists(
      atPath: "/Library/Apple/usr/share/rosetta/rosetta")

    let freeBytes: Int64?
    if !DiagnosticsPathPolicy.isHardExcludedSource(dataDirectory),
      let values = try? dataDirectory.resourceValues(forKeys: [
        .volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey,
      ])
    {
      if let important = values.volumeAvailableCapacityForImportantUsage {
        freeBytes = important
      } else if let basic = values.volumeAvailableCapacity {
        freeBytes = Int64(basic)
      } else {
        freeBytes = nil
      }
    } else {
      freeBytes = nil
    }

    let memGiB = Int((Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824.0).rounded())
    let record = DiagnosticsEnvironmentRecord.HostHardwareRecord(
      arch: arch,
      isRosettaTranslated: translated,
      rosettaRuntimePresent: rosettaPresent,
      operatingSystemVersionString: ProcessInfo.processInfo.operatingSystemVersionString,
      processorCount: ProcessInfo.processInfo.processorCount,
      physicalMemoryGiB: max(1, memGiB),
      dataVolumeFreeBytes: freeBytes)
    return (record, arm64Capable)
  }

  static func inspectPermissions(
    bundleId: String,
    accessibilityTrusted: Bool,
    screenRecordingTrusted: Bool
  ) -> DiagnosticsEnvironmentRecord.PermissionSnapshotRecord {
    let duplicates = countDuplicateAppBundles(bundleId: bundleId)
    return .init(
      accessibilityTrusted: accessibilityTrusted,
      duplicateAppBundlesCount: duplicates,
      screenRecordingTrusted: screenRecordingTrusted,
      listenEventTrusted: CGPreflightListenEventAccess(),
      postEventTrusted: CGPreflightPostEventAccess(),
      secureEventInputEnabled: IsSecureEventInputEnabled())
  }

  static func countDuplicateAppBundles(bundleId: String) -> Int {
    guard !bundleId.isEmpty,
      let unmanaged = LSCopyApplicationURLsForBundleIdentifier(bundleId as CFString, nil),
      let urls = unmanaged.takeRetainedValue() as? [URL]
    else { return 1 }
    let distinct = Set(urls.map { $0.standardizedFileURL.path(percentEncoded: false) })
    return max(1, distinct.count)
  }

  static func inspectSystemProxyFlags() -> DiagnosticsEnvironmentRecord.SystemProxyFlagsRecord {
    guard let raw = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any] else {
      return .init(
        pacEnabled: false, wpadEnabled: false, httpProxyEnabled: false,
        httpsProxyEnabled: false, socksProxyEnabled: false)
    }
    func flag(_ key: CFString) -> Bool {
      (raw[key as String] as? NSNumber)?.boolValue == true
    }
    return .init(
      pacEnabled: flag(kCFNetworkProxiesProxyAutoConfigEnable),
      wpadEnabled: flag(kCFNetworkProxiesProxyAutoDiscoveryEnable),
      httpProxyEnabled: flag(kCFNetworkProxiesHTTPEnable),
      httpsProxyEnabled: flag(kCFNetworkProxiesHTTPSEnable),
      socksProxyEnabled: flag(kCFNetworkProxiesSOCKSEnable))
  }

  static func countCustomAdminRootCertificates() -> Int {
    var total = 0
    for domain in [SecTrustSettingsDomain.admin, .user] {
      var certs: CFArray?
      if SecTrustSettingsCopyCertificates(domain, &certs) == errSecSuccess, let certs {
        total += CFArrayGetCount(certs)
      }
    }
    return total
  }

  static func inspectLoginItemStatus(isDevelopment: Bool) -> String {
    guard !isDevelopment else { return "not_applicable_debug" }
    return switch SMAppService.mainApp.status {
    case .enabled: "enabled"
    case .notRegistered: "not_registered"
    case .requiresApproval: "requires_approval"
    case .notFound: "not_found"
    @unknown default: "unknown"
    }
  }

  static func inspectFinderSync(builtInPlugInsURL: URL?, timeoutMs: Int = 300) -> FinderSyncStatus {
    guard let plugIns = builtInPlugInsURL,
      let extBundle = Bundle(url: plugIns.appending(path: "AtdFinderSync.appex")),
      let identifier = extBundle.bundleIdentifier
    else {
      return FinderSyncStatus(state: .absent)
    }

    let process = Process()
    let outPipe = Pipe()
    process.executableURL = URL(filePath: "/usr/bin/pluginkit")
    process.arguments = ["-m", "-i", identifier]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = outPipe
    process.standardError = FileHandle.nullDevice

    let done = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in done.signal() }
    do {
      try process.run()
    } catch {
      return FinderSyncStatus(state: .unavailable)
    }

    if done.wait(timeout: .now() + .milliseconds(timeoutMs)) == .timedOut {
      process.terminate()
      return FinderSyncStatus(state: .unavailable)
    }
    guard process.terminationStatus == 0 else { return FinderSyncStatus(state: .unavailable) }
    let data = (try? outPipe.fileHandleForReading.read(upToCount: 16_384)) ?? Data()
    let text = String(decoding: data, as: UTF8.self)
    guard let line = text.split(separator: "\n").first(where: { $0.contains("\(identifier)(") })
    else {
      return FinderSyncStatus(state: .absent)
    }
    if line.hasPrefix("+") { return FinderSyncStatus(state: .enabled) }
    if line.hasPrefix("-") { return FinderSyncStatus(state: .disabled) }
    return FinderSyncStatus(state: .undecided)
  }

  private static func isBundleTranslocated(_ bundleURL: URL, rawPath: String) -> Bool {
    if rawPath.contains("/AppTranslocation/") { return true }
    typealias SecTranslocateIsTranslocatedFn =
      @convention(c) (
        CFURL, UnsafeMutablePointer<Bool>, UnsafeMutablePointer<Unmanaged<CFError>?>?
      ) -> Bool
    guard
      let handle = dlopen(
        "/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY | RTLD_NOLOAD),
      let sym = dlsym(handle, "SecTranslocateIsTranslocatedURL")
    else { return false }
    let fn = unsafeBitCast(sym, to: SecTranslocateIsTranslocatedFn.self)
    var translocated = false
    if fn(bundleURL as CFURL, &translocated, nil) {
      return translocated
    }
    return false
  }

  private static func sysctlInt32(_ name: String) -> Int32? {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
    return value
  }
}
