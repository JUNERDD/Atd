import CryptoKit
import Darwin
import Foundation
import Security

@_silgen_name("csops")
nonisolated private func csops(
  _ pid: pid_t, _ ops: UInt32, _ useraddr: UnsafeMutableRawPointer?, _ usersize: Int
) -> Int32

/// Cryptographically verifies a running process's **kernel-resident** code signature (`csops`
/// `CS_OPS_STATUS`, `CS_OPS_CDHASH`, and `CS_OPS_BLOB`) independently of whatever files currently
/// sit on disk. Used when `SecCodeCheckValidity` reports `errSecCSStaticCodeChanged` (for example,
/// a browser that staged an update in place while still running), where
/// `SecCodeCopySigningInformation` would otherwise read identifiers and certificates from the
/// replaced on-disk bundle instead of the running process.
nonisolated enum ChromeRunningCodeSignature {
  struct VerifiedCode: Equatable, Sendable {
    let signingIdentifier: String
    let teamId: String
  }

  private static let csOpsStatus: UInt32 = 0
  private static let csOpsCDHash: UInt32 = 5
  private static let csOpsBlob: UInt32 = 10

  private static let cdHashByteCount = 20
  private static let maxSuperBlobBytes = 16 * 1024 * 1024

  private static let magicEmbeddedSignature: UInt32 = 0xfade_0cc0
  private static let magicCodeDirectory: UInt32 = 0xfade_0c02
  private static let magicBlobWrapper: UInt32 = 0xfade_0b01

  private static let slotCodeDirectory: UInt32 = 0
  private static let slotSignature: UInt32 = 0x10000
  private static let minCodeDirectoryVersionWithTeam: UInt32 = 0x0002_0200

  private static let developerIDCAOID = "1.2.840.113635.100.6.2.6"
  private static let developerIDLeafOID = "1.2.840.113635.100.6.1.13"
  private static let oidOrganizationName = "2.5.4.10"
  private static let oidOrganizationalUnitName = "2.5.4.11"

  /// Reads and verifies the kernel-resident code signature of `pid`, returning its verified
  /// `(signingIdentifier, teamId)` iff `pid` is dynamically valid, non-ad-hoc, and signed by an
  /// Apple-anchored Developer ID Application chain. Re-checks `CS_OPS_STATUS` and `CS_OPS_CDHASH`
  /// after reading `CS_OPS_BLOB` to defeat inter-`csops` PID/exec races.
  static func verifyRunningProcess(pid: pid_t) -> VerifiedCode? {
    guard pid > 0,
      isDynamicallyValidNonAdHoc(pid: pid),
      let expectedCDHash = readKernelCDHash(pid: pid),
      let superBlob = readKernelSuperBlob(pid: pid),
      isDynamicallyValidNonAdHoc(pid: pid),
      readKernelCDHash(pid: pid) == expectedCDHash
    else { return nil }
    return verifySuperBlob(superBlob, expectedCDHash: expectedCDHash)
  }

  /// Pure cryptographic verification of an embedded signature `SuperBlob` against `expectedCDHash`:
  /// 1. Extracts the primary `CodeDirectory` and detached `CMS` signature slot.
  /// 2. Confirms the `CodeDirectory`'s truncated digest equals `expectedCDHash`.
  /// 3. Extracts and validates non-ad-hoc flags, `signingIdentifier` (non-self), and `teamId`.
  /// 4. Verifies the `CMS` signature over the exact `CodeDirectory` bytes and evaluates `SecTrust`
  ///    under `kSecPolicyAppleCodeSigning` pinned strictly to Apple Root CAs (at the Apple CMS
  ///    timestamp when present, else current time).
  /// 5. Confirms the Developer ID CA (`1.2.840.113635.100.6.2.6`) and Developer ID Application leaf
  ///    (`1.2.840.113635.100.6.1.13`) extensions and `leaf[subject.OU] == teamId`.
  static func verifySuperBlob(_ blob: Data, expectedCDHash: Data) -> VerifiedCode? {
    guard expectedCDHash.count == cdHashByteCount, blob.count >= 12 else { return nil }
    guard u32(blob, at: 0) == magicEmbeddedSignature else { return nil }
    let totalLength = Int(u32(blob, at: 4))
    let slotCount = Int(u32(blob, at: 8))
    guard totalLength >= 12, totalLength <= blob.count,
      slotCount >= 2, slotCount <= 64
    else { return nil }
    let indexEnd = 12 + slotCount * 8
    guard indexEnd <= totalLength else { return nil }

    var primaryCD: Data?
    var cmsData: Data?
    for index in 0..<slotCount {
      let slotType = u32(blob, at: 12 + index * 8)
      let slotOffset = Int(u32(blob, at: 16 + index * 8))
      guard slotOffset >= indexEnd, slotOffset + 8 <= totalLength else { return nil }
      let slotMagic = u32(blob, at: slotOffset)
      let slotLength = Int(u32(blob, at: slotOffset + 4))
      guard slotLength >= 8, slotOffset + slotLength <= totalLength else { return nil }
      if slotType == slotCodeDirectory, slotMagic == magicCodeDirectory {
        primaryCD = blob.subdata(in: slotOffset..<(slotOffset + slotLength))
      } else if slotType == slotSignature, slotMagic == magicBlobWrapper, slotLength > 8 {
        cmsData = blob.subdata(in: (slotOffset + 8)..<(slotOffset + slotLength))
      }
    }

    guard let primaryCD, let cmsData,
      computeCDHash(of: primaryCD) == expectedCDHash,
      let cdIdentity = parseCodeDirectory(primaryCD),
      verifyDeveloperIDCMS(
        cmsData: cmsData, codeDirectory: primaryCD, expectedTeamId: cdIdentity.teamId)
    else { return nil }
    return cdIdentity
  }

  private static func isDynamicallyValidNonAdHoc(pid: pid_t) -> Bool {
    var rawStatus: UInt32 = 0
    guard csops(pid, csOpsStatus, &rawStatus, MemoryLayout<UInt32>.size) == 0 else { return false }
    let status = SecCodeStatus(rawValue: rawStatus)
    return status.contains(.valid)
      && !status.contains(.debugged)
      && (rawStatus & SecCodeSignatureFlags.adhoc.rawValue) == 0
  }

  private static func readKernelCDHash(pid: pid_t) -> Data? {
    var bytes = [UInt8](repeating: 0, count: cdHashByteCount)
    guard csops(pid, csOpsCDHash, &bytes, bytes.count) == 0,
      bytes.contains(where: { $0 != 0 })
    else { return nil }
    return Data(bytes)
  }

  private static func readKernelSuperBlob(pid: pid_t) -> Data? {
    var header = [UInt8](repeating: 0, count: 8)
    let probe = csops(pid, csOpsBlob, &header, header.count)
    guard probe != 0, errno == ERANGE else { return nil }
    let needed = Int(
      (UInt32(header[4]) << 24) | (UInt32(header[5]) << 16)
        | (UInt32(header[6]) << 8) | UInt32(header[7]))
    guard needed >= 12, needed <= maxSuperBlobBytes else { return nil }
    var buffer = [UInt8](repeating: 0, count: needed)
    guard csops(pid, csOpsBlob, &buffer, buffer.count) == 0 else { return nil }
    let data = Data(buffer)
    let actual = Int(u32(data, at: 4))
    guard actual >= 12, actual <= data.count else { return nil }
    return data.prefix(actual)
  }

  private static func computeCDHash(of codeDirectory: Data) -> Data? {
    guard codeDirectory.count >= 38 else { return nil }
    let hashType = codeDirectory[codeDirectory.startIndex + 37]
    switch hashType {
    case 1:
      return Data(Insecure.SHA1.hash(data: codeDirectory).prefix(cdHashByteCount))
    case 2, 3:
      return Data(SHA256.hash(data: codeDirectory).prefix(cdHashByteCount))
    case 4:
      return Data(SHA384.hash(data: codeDirectory).prefix(cdHashByteCount))
    case 5:
      return Data(SHA512.hash(data: codeDirectory).prefix(cdHashByteCount))
    default:
      return nil
    }
  }

  private static func parseCodeDirectory(_ cd: Data) -> VerifiedCode? {
    guard cd.count >= 52, u32(cd, at: 0) == magicCodeDirectory else { return nil }
    let version = u32(cd, at: 8)
    let flags = u32(cd, at: 12)
    guard version >= minCodeDirectoryVersionWithTeam,
      (flags & SecCodeSignatureFlags.adhoc.rawValue) == 0
    else { return nil }
    let identOffset = Int(u32(cd, at: 20))
    let teamOffset = Int(u32(cd, at: 48))
    guard identOffset >= 44, teamOffset >= 52,
      let signingId = readCString(in: cd, at: identOffset),
      let teamId = readCString(in: cd, at: teamOffset),
      ChromeBrowserSignature.isValidSigningIdentifier(signingId),
      !ChromeBrowserSignature.isSelfIdentifier(signingId),
      ChromeBrowserSignature.isValidTeamId(teamId)
    else { return nil }
    return VerifiedCode(signingIdentifier: signingId, teamId: teamId)
  }

  private static func verifyDeveloperIDCMS(
    cmsData: Data, codeDirectory: Data, expectedTeamId: String
  ) -> Bool {
    var decoderOpt: CMSDecoder?
    guard CMSDecoderCreate(&decoderOpt) == errSecSuccess, let decoder = decoderOpt else {
      return false
    }
    let updated = cmsData.withUnsafeBytes { raw -> OSStatus in
      guard let base = raw.baseAddress else { return errSecParam }
      return CMSDecoderUpdateMessage(decoder, base, raw.count)
    }
    var numSigners = 0
    guard updated == errSecSuccess,
      CMSDecoderFinalizeMessage(decoder) == errSecSuccess,
      CMSDecoderSetDetachedContent(decoder, codeDirectory as CFData) == errSecSuccess,
      CMSDecoderGetNumSigners(decoder, &numSigners) == errSecSuccess,
      numSigners >= 1,
      let policy = SecPolicyCreateWithProperties(kSecPolicyAppleCodeSigning, nil)
    else { return false }

    var signerStatus = CMSSignerStatus.unsigned
    var trustOpt: SecTrust?
    var certErr: OSStatus = 0
    guard
      CMSDecoderCopySignerStatus(decoder, 0, policy, false, &signerStatus, &trustOpt, &certErr)
        == errSecSuccess,
      signerStatus == .valid,
      let trust = trustOpt
    else { return false }

    var timestamp: CFAbsoluteTime = 0
    if CMSDecoderCopySignerTimestampWithPolicy(decoder, nil, 0, &timestamp) == errSecSuccess {
      SecTrustSetVerifyDate(trust, Date(timeIntervalSinceReferenceDate: timestamp) as CFDate)
    }
    let appleRoots = appleRootCertificates()
    guard !appleRoots.isEmpty,
      SecTrustSetAnchorCertificates(trust, appleRoots as CFArray) == errSecSuccess,
      SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
      SecTrustEvaluateWithError(trust, nil),
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      chain.count >= 3
    else { return false }

    return hasExtension(chain[0], oid: developerIDLeafOID)
      && hasExtension(chain[1], oid: developerIDCAOID)
      && subjectAttribute(of: chain[0], oid: oidOrganizationalUnitName) == expectedTeamId
  }

  private static func appleRootCertificates() -> [SecCertificate] {
    var rootsOpt: CFArray?
    guard SecTrustCopyAnchorCertificates(&rootsOpt) == errSecSuccess,
      let roots = rootsOpt as? [SecCertificate]
    else { return [] }
    return roots.filter { cert in
      var cn: CFString?
      _ = SecCertificateCopyCommonName(cert, &cn)
      return (cn as String? ?? "").hasPrefix("Apple Root CA")
        && subjectAttribute(of: cert, oid: oidOrganizationName) == "Apple Inc."
    }
  }

  private static func hasExtension(_ cert: SecCertificate, oid: String) -> Bool {
    guard
      let values = SecCertificateCopyValues(cert, [oid as CFString] as CFArray, nil)
        as? [String: Any]
    else { return false }
    return values[oid] != nil
  }

  private static func subjectAttribute(of cert: SecCertificate, oid: String) -> String? {
    guard
      let values = SecCertificateCopyValues(
        cert, [kSecOIDX509V1SubjectName] as CFArray, nil) as? [String: Any],
      let section = values[kSecOIDX509V1SubjectName as String] as? [String: Any],
      let items = section[kSecPropertyKeyValue as String] as? [[String: Any]]
    else { return nil }
    return items.first { ($0[kSecPropertyKeyLabel as String] as? String) == oid }?[
      kSecPropertyKeyValue as String
    ] as? String
  }

  private static func u32(_ data: Data, at offset: Int) -> UInt32 {
    let base = data.startIndex + offset
    return (UInt32(data[base]) << 24) | (UInt32(data[base + 1]) << 16)
      | (UInt32(data[base + 2]) << 8) | UInt32(data[base + 3])
  }

  private static func readCString(in data: Data, at offset: Int) -> String? {
    guard offset >= 0, offset < data.count else { return nil }
    let start = data.startIndex + offset
    guard let nul = data[start...].firstIndex(of: 0), nul - start <= 256 else { return nil }
    return String(bytes: data[start..<nul], encoding: .utf8)
  }
}
