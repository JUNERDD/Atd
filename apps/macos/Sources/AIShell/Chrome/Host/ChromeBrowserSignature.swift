import AIChromeChannelKit
import Darwin
import Foundation
import Security

/// Cryptographic identity of a verified Developer ID–signed browser that launched `atd-chrome-host`.
nonisolated struct ChromeBrowserIdentity: Equatable, Sendable {
  let signingIdentifier: String
  let teamId: String
  let developerName: String
  let bundlePath: String

  /// Human-readable developer label shown in the pairing alert (`"At Inc. · 8CPD4K4TBB"`).
  var developerLabel: String {
    developerName != teamId && !developerName.isEmpty
      ? "\(developerName) · \(teamId)" : teamId
  }
}

/// Verifies that the process which launched `atd-chrome-host` is a Developer ID–signed macOS web
/// browser (D3): validly signed with an Apple-anchored Developer ID Application certificate, an
/// `.app` application bundle declaring both `http` and `https` URL schemes, and never Atd itself.
/// Unsigned and ad-hoc binaries are rejected in both Release and Debug builds so caller-origin
/// enforcement and TOFU pairing always rest on a cryptographic `(teamId, signingIdentifier)`.
nonisolated enum ChromeBrowserSignature {
  /// Generic Developer ID requirement: Apple-anchored chain whose intermediate carries the
  /// Developer ID CA marker (1.2.840.113635.100.6.2.6) and whose leaf carries the Developer ID
  /// Application marker (1.2.840.113635.100.6.1.13).
  private static let genericRequirementText =
    "anchor apple generic"
    + " and certificate 1[field.1.2.840.113635.100.6.2.6]"
    + " and certificate leaf[field.1.2.840.113635.100.6.1.13]"

  /// Verifies running process `pid` and returns its browser identity, or `nil` for any unsigned,
  /// ad-hoc, non-browser, self, ended, or unreadable process. Reads the signature from disk, so
  /// call off the main actor.
  ///
  /// A browser that staged an update in place keeps running code that no longer matches its bundle
  /// on disk until relaunch (`errSecCSStaticCodeChanged`). Only that failure is reconsidered: the
  /// kernel must report the running code valid and non-ad-hoc, and the on-disk bundle must pass a
  /// pinned Developer ID requirement for the exact same `(signingIdentifier, teamId)`.
  static func verify(pid: pid_t) -> ChromeBrowserIdentity? {
    guard pid > 0 else { return nil }
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)]
    var code: SecCode?
    var requirement: SecRequirement?
    guard
      SecCodeCopyGuestWithAttributes(nil, attributes as CFDictionary, [], &code) == errSecSuccess,
      let code,
      SecRequirementCreateWithString(genericRequirementText as CFString, [], &requirement)
        == errSecSuccess,
      let requirement
    else { return nil }

    let checked = SecCodeCheckValidity(code, [], requirement)
    if checked == errSecSuccess {
      var staticCode: SecStaticCode?
      guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
        return nil
      }
      return validateStaticBrowser(staticCode)
    }
    guard checked == errSecCSStaticCodeChanged else { return nil }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
      return nil
    }
    return verifyUpdatedInPlace(runningPid: pid, staticCode: staticCode)
  }

  /// Validates an on-disk `.app` bundle using the same Developer ID and browser-bundle rules
  /// (without re-hashing resources). Used for static inspection and unit tests.
  static func verifyStaticBundle(at bundleURL: URL) -> ChromeBrowserIdentity? {
    var staticCode: SecStaticCode?
    var requirement: SecRequirement?
    guard
      SecStaticCodeCreateWithPath(bundleURL as CFURL, [], &staticCode) == errSecSuccess,
      let staticCode,
      SecRequirementCreateWithString(genericRequirementText as CFString, [], &requirement)
        == errSecSuccess,
      let requirement,
      SecStaticCodeCheckValidity(
        staticCode, SecCSFlags(rawValue: kSecCSDoNotValidateResources), requirement)
        == errSecSuccess
    else { return nil }
    return validateStaticBrowser(staticCode)
  }

  /// Verifies an updated-in-place browser by cryptographically checking the **running** process's
  /// kernel-resident signature (`ChromeRunningCodeSignature`) independently of disk, then pinning
  /// the on-disk `staticCode` bundle to that exact `(signingIdentifier, teamId)`.
  static func verifyUpdatedInPlace(
    runningPid: pid_t, staticCode: SecStaticCode
  ) -> ChromeBrowserIdentity? {
    guard let running = ChromeRunningCodeSignature.verifyRunningProcess(pid: runningPid) else {
      return nil
    }
    let pinnedText =
      "identifier \"\(running.signingIdentifier)\" and \(genericRequirementText)"
      + " and certificate leaf[subject.OU] = \"\(running.teamId)\""
    var pinned: SecRequirement?
    guard
      SecRequirementCreateWithString(pinnedText as CFString, [], &pinned) == errSecSuccess,
      let pinned,
      SecStaticCodeCheckValidity(
        staticCode, SecCSFlags(rawValue: kSecCSDoNotValidateResources), pinned) == errSecSuccess,
      let identity = validateStaticBrowser(staticCode),
      identity.signingIdentifier == running.signingIdentifier,
      identity.teamId == running.teamId
    else { return nil }
    return identity
  }

  private static func validateStaticBrowser(_ staticCode: SecStaticCode) -> ChromeBrowserIdentity? {
    var cfURL: CFURL?
    var cfInfo: CFDictionary?
    let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
    guard
      SecCodeCopyPath(staticCode, [], &cfURL) == errSecSuccess,
      let bundleURL = cfURL as URL?,
      SecCodeCopySigningInformation(staticCode, flags, &cfInfo) == errSecSuccess,
      let info = cfInfo as? [String: Any],
      let signingIdentifier = info[kSecCodeInfoIdentifier as String] as? String,
      let teamId = info[kSecCodeInfoTeamIdentifier as String] as? String,
      isValidSigningIdentifier(signingIdentifier),
      isValidTeamId(teamId),
      let infoPlist = info[kSecCodeInfoPList as String] as? [String: Any],
      isValidBrowserBundle(
        infoPlist: infoPlist, signingIdentifier: signingIdentifier,
        bundleExtension: bundleURL.pathExtension)
    else { return nil }

    var commonName: CFString?
    if let leaf = (info[kSecCodeInfoCertificates as String] as? [SecCertificate])?.first {
      _ = SecCertificateCopyCommonName(leaf, &commonName)
    }
    let developerName = formatDeveloperName(commonName: commonName as String?, teamId: teamId)
    return ChromeBrowserIdentity(
      signingIdentifier: signingIdentifier,
      teamId: teamId,
      developerName: developerName,
      bundlePath: bundleURL.path(percentEncoded: false))
  }

  /// Validates the signed bundle metadata: `.app`, `APPL`, declares both `http` and `https`, and
  /// is never Atd itself (`com.junerdd.ai` or `com.junerdd.ai.*`).
  static func isValidBrowserBundle(
    infoPlist: [String: Any], signingIdentifier: String, bundleExtension: String
  ) -> Bool {
    guard bundleExtension.lowercased() == "app" else { return false }
    guard infoPlist["CFBundlePackageType"] as? String == "APPL" else { return false }
    guard !isSelfIdentifier(signingIdentifier) else { return false }
    if let bundleId = infoPlist["CFBundleIdentifier"] as? String, isSelfIdentifier(bundleId) {
      return false
    }
    guard let urlTypes = infoPlist["CFBundleURLTypes"] as? [[String: Any]] else { return false }
    var schemes = Set<String>()
    for entry in urlTypes {
      if let list = entry["CFBundleURLSchemes"] as? [String] {
        for scheme in list { schemes.insert(scheme.lowercased()) }
      }
    }
    return schemes.contains("http") && schemes.contains("https")
  }

  static func isSelfIdentifier(_ value: String) -> Bool {
    let lower = value.lowercased()
    return lower == "com.junerdd.ai" || lower.hasPrefix("com.junerdd.ai.")
  }

  /// Strict ASCII `[A-Za-z0-9._-]{1,255}` check to prevent SecRequirement syntax injection.
  static func isValidSigningIdentifier(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 255 else { return false }
    return value.utf8.allSatisfy { byte in
      (0x30...0x39).contains(byte) || (0x41...0x5a).contains(byte) || (0x61...0x7a).contains(byte)
        || byte == 0x2e || byte == 0x5f || byte == 0x2d
    }
  }

  /// Strict ASCII `[A-Za-z0-9]{1,32}` check to prevent SecRequirement syntax injection.
  static func isValidTeamId(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 32 else { return false }
    return value.utf8.allSatisfy { byte in
      (0x30...0x39).contains(byte) || (0x41...0x5a).contains(byte) || (0x61...0x7a).contains(byte)
    }
  }

  /// Strips `"Developer ID Application: "` prefix and trailing `" (<teamId>)"` from the leaf
  /// certificate's common name, falling back to `teamId`.
  static func formatDeveloperName(commonName: String?, teamId: String) -> String {
    guard var name = commonName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty
    else { return teamId }
    let prefix = "Developer ID Application: "
    if name.hasPrefix(prefix) {
      name.removeFirst(prefix.count)
    }
    let suffix = " (\(teamId))"
    if name.hasSuffix(suffix) {
      name.removeLast(suffix.count)
    }
    name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? teamId : name.clipped(toUTF16: 120)
  }
}
