import AIChromeChannelKit
import AppKit
import CryptoKit
import Darwin
import Foundation
import Security
import Testing

@testable import AIShell

@Suite("ChromeBrowserSignature verification and metadata validation")
struct ChromeBrowserSignatureTests {
  private static func browserPlist(
    bundleId: String = "at.studio.AsideBrowser",
    packageType: String = "APPL",
    urlTypes: [[String: Any]]? = [
      ["CFBundleURLSchemes": ["http", "https"]]
    ]
  ) -> [String: Any] {
    var dict: [String: Any] = [
      "CFBundleIdentifier": bundleId,
      "CFBundlePackageType": packageType,
    ]
    if let urlTypes { dict["CFBundleURLTypes"] = urlTypes }
    return dict
  }

  @Test("Bundle Info.plist validation requires .app, APPL, and both http and https schemes")
  func bundleInfoPlistValidation() {
    #expect(
      ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(), signingIdentifier: "at.studio.AsideBrowser",
        bundleExtension: "app"))

    // Mixed case across separate URL types is accepted.
    #expect(
      ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(urlTypes: [
          ["CFBundleURLSchemes": ["HTTP"]],
          ["CFBundleURLSchemes": ["HTTPS", "file"]],
        ]),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))

    // Missing http or https is rejected.
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(urlTypes: [["CFBundleURLSchemes": ["http"]]]),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(urlTypes: [["CFBundleURLSchemes": ["https"]]]),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(urlTypes: nil),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))

    // Non-APPL package types and non-.app extensions are rejected.
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(packageType: "FMWK"),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "xpc"))
  }

  @Test("Self-exclusion rejects com.junerdd.ai and com.junerdd.ai.* in signing or bundle IDs")
  func selfExclusion() {
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(bundleId: "com.example.Browser"),
        signingIdentifier: "com.junerdd.ai",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(bundleId: "com.example.Browser"),
        signingIdentifier: "com.junerdd.ai.dev",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(bundleId: "com.junerdd.ai.dev"),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))
    #expect(
      !ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(bundleId: "COM.JUNERDD.AI"),
        signingIdentifier: "com.example.Browser",
        bundleExtension: "app"))
    // Non-matching sibling namespace is allowed.
    #expect(
      ChromeBrowserSignature.isValidBrowserBundle(
        infoPlist: Self.browserPlist(bundleId: "com.junerdd.browser"),
        signingIdentifier: "com.junerdd.browser",
        bundleExtension: "app"))
  }

  @Test("Strict ASCII validation blocks SecRequirement syntax injection in identifier and teamId")
  func asciiValidationBlocksRequirementInjection() {
    #expect(ChromeBrowserSignature.isValidSigningIdentifier("com.google.Chrome"))
    #expect(ChromeBrowserSignature.isValidSigningIdentifier("at.studio.Aside_Browser-1"))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier(""))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier("com.foo\" or anchor apple generic"))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier("com.foo bar"))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier("com.foo/bar"))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier("com.fóo"))
    #expect(!ChromeBrowserSignature.isValidSigningIdentifier(String(repeating: "a", count: 256)))

    #expect(ChromeBrowserSignature.isValidTeamId("8CPD4K4TBB"))
    #expect(ChromeBrowserSignature.isValidTeamId("EQHXZ8M8AV"))
    #expect(!ChromeBrowserSignature.isValidTeamId(""))
    #expect(!ChromeBrowserSignature.isValidTeamId("8CPD4K4TBB\" or true"))
    #expect(!ChromeBrowserSignature.isValidTeamId("8CPD-4K4T"))
    #expect(!ChromeBrowserSignature.isValidTeamId("8CPD 4K4T"))
    #expect(!ChromeBrowserSignature.isValidTeamId(String(repeating: "A", count: 33)))
  }

  @Test("developerName strips Developer ID prefix/suffix and formats developerLabel")
  func developerNameAndLabelFormatting() {
    let asideName = ChromeBrowserSignature.formatDeveloperName(
      commonName: "Developer ID Application: At Inc. (8CPD4K4TBB)", teamId: "8CPD4K4TBB")
    #expect(asideName == "At Inc.")
    let aside = ChromeBrowserIdentity(
      signingIdentifier: "at.studio.AsideBrowser", teamId: "8CPD4K4TBB",
      developerName: asideName, bundlePath: "/Applications/Aside.app")
    #expect(aside.developerLabel == "At Inc. · 8CPD4K4TBB")

    let googleName = ChromeBrowserSignature.formatDeveloperName(
      commonName: "Developer ID Application: Google LLC (EQHXZ8M8AV)", teamId: "EQHXZ8M8AV")
    #expect(googleName == "Google LLC")

    let fallbackName = ChromeBrowserSignature.formatDeveloperName(
      commonName: nil, teamId: "8CPD4K4TBB")
    #expect(fallbackName == "8CPD4K4TBB")
    let fallback = ChromeBrowserIdentity(
      signingIdentifier: "at.studio.AsideBrowser", teamId: "8CPD4K4TBB",
      developerName: fallbackName, bundlePath: "/Applications/Aside.app")
    #expect(fallback.developerLabel == "8CPD4K4TBB")
  }

  @Test("Live verification rejects current non-browser test process and invalid PIDs")
  func liveCheckRejectsNonBrowserProcess() {
    #expect(ChromeBrowserSignature.verify(pid: getpid()) == nil)
    #expect(ChromeBrowserSignature.verify(pid: 0) == nil)
    #expect(ChromeBrowserSignature.verify(pid: -1) == nil)
  }

  @Test("Static verification validates installed Developer ID browsers and rejects non-browsers")
  func staticVerificationAgainstInstalledApps() {
    let chromeURL = URL(filePath: "/Applications/Google Chrome.app")
    if FileManager.default.fileExists(atPath: chromeURL.path(percentEncoded: false)) {
      let identity = ChromeBrowserSignature.verifyStaticBundle(at: chromeURL)
      #expect(identity?.signingIdentifier == "com.google.Chrome")
      #expect(identity?.teamId == "EQHXZ8M8AV")
      #expect(identity?.developerName == "Google LLC")
      #expect(identity?.developerLabel == "Google LLC · EQHXZ8M8AV")
    }

    let asideURL = URL(filePath: "/Applications/Aside.app")
    if FileManager.default.fileExists(atPath: asideURL.path(percentEncoded: false)) {
      let identity = ChromeBrowserSignature.verifyStaticBundle(at: asideURL)
      #expect(identity?.signingIdentifier == "at.studio.AsideBrowser")
      #expect(identity?.teamId == "8CPD4K4TBB")
      #expect(identity?.developerName == "At Inc.")
      #expect(identity?.developerLabel == "At Inc. · 8CPD4K4TBB")
    }

    // Non-browser system app must be rejected.
    let calculatorURL = URL(filePath: "/System/Applications/Calculator.app")
    if FileManager.default.fileExists(atPath: calculatorURL.path(percentEncoded: false)) {
      #expect(ChromeBrowserSignature.verifyStaticBundle(at: calculatorURL) == nil)
    }
  }

  private static func extractSuperBlob(from executableURL: URL) throws -> Data? {
    let data = try Data(contentsOf: executableURL)
    guard data.count >= 32 else { return nil }
    func be32(_ off: Int) -> UInt32 {
      (UInt32(data[off]) << 24) | (UInt32(data[off + 1]) << 16)
        | (UInt32(data[off + 2]) << 8) | UInt32(data[off + 3])
    }
    func le32(_ off: Int) -> UInt32 {
      UInt32(data[off]) | (UInt32(data[off + 1]) << 8)
        | (UInt32(data[off + 2]) << 16) | (UInt32(data[off + 3]) << 24)
    }
    var sliceOffset = 0
    if be32(0) == 0xcafe_babe, be32(4) >= 1, data.count >= 28 {
      sliceOffset = Int(be32(16))
    }
    guard sliceOffset + 32 <= data.count, le32(sliceOffset) == 0xfeed_facf else { return nil }
    let ncmds = Int(le32(sliceOffset + 16))
    var cursor = sliceOffset + 32
    for _ in 0..<ncmds {
      guard cursor + 8 <= data.count else { return nil }
      let cmd = le32(cursor)
      let cmdsize = Int(le32(cursor + 4))
      guard cmdsize >= 8, cursor + cmdsize <= data.count else { return nil }
      if cmd == 0x1d, cmdsize >= 16 {
        let off = sliceOffset + Int(le32(cursor + 8))
        let size = Int(le32(cursor + 12))
        guard off >= 0, size >= 12, off + size <= data.count else { return nil }
        let totalLength = Int(be32(off + 4))
        guard totalLength >= 12, totalLength <= size else { return nil }
        return data.subdata(in: off..<(off + totalLength))
      }
      cursor += cmdsize
    }
    return nil
  }

  @Test("verifyUpdatedInPlace and verifySuperBlob defeat disk-swap and self-signed certs")
  func updatedInPlaceDefeatsDiskSwapAndSelfSignedCertificates() throws {
    let browserCandidates = [
      URL(filePath: "/Applications/Aside.app"),
      URL(filePath: "/Applications/Google Chrome.app"),
    ]
    if let browserURL = browserCandidates.first(where: {
      FileManager.default.fileExists(atPath: $0.path(percentEncoded: false))
    }) {
      var staticCode: SecStaticCode?
      #expect(SecStaticCodeCreateWithPath(browserURL as CFURL, [], &staticCode) == errSecSuccess)
      if let staticCode {
        // Disk-swap counterexample: non-Developer-ID running process paired with real browser
        // staticCode on disk MUST fail closed.
        #expect(
          ChromeBrowserSignature.verifyUpdatedInPlace(
            runningPid: getpid(), staticCode: staticCode) == nil)
        for atd in NSRunningApplication.runningApplications(
          withBundleIdentifier: "com.junerdd.ai.dev")
        where atd.processIdentifier > 0 && !atd.isTerminated {
          #expect(ChromeBrowserSignature.verify(pid: atd.processIdentifier) == nil)
          #expect(
            ChromeBrowserSignature.verifyUpdatedInPlace(
              runningPid: atd.processIdentifier, staticCode: staticCode) == nil)
        }
      }

      if let execURL = Bundle(url: browserURL)?.executableURL,
        let superBlob = try Self.extractSuperBlob(from: execURL),
        let cdhash = ChromeCodeSignature.cdhash(ofCodeAt: browserURL)
      {
        let verified = try #require(
          ChromeRunningCodeSignature.verifySuperBlob(superBlob, expectedCDHash: cdhash))
        #expect(!verified.signingIdentifier.isEmpty)
        #expect(!verified.teamId.isEmpty)

        // Mismatched kernel cdhash must fail closed.
        var wrongHash = cdhash
        wrongHash[0] ^= 0xff
        #expect(
          ChromeRunningCodeSignature.verifySuperBlob(superBlob, expectedCDHash: wrongHash) == nil)

        // Corrupting a byte inside the CMS signature slot must fail CMS verification.
        var tamperedCMS = superBlob
        tamperedCMS[tamperedCMS.count - 32] ^= 0xff
        #expect(
          ChromeRunningCodeSignature.verifySuperBlob(tamperedCMS, expectedCDHash: cdhash) == nil)

        // Forging CodeDirectory bytes + recomputing expectedCDHash must still fail CMS detached
        // signature verification.
        let cdOffset = Int(
          (UInt32(superBlob[16]) << 24) | (UInt32(superBlob[17]) << 16)
            | (UInt32(superBlob[18]) << 8) | UInt32(superBlob[19]))
        let cdLen = Int(
          (UInt32(superBlob[cdOffset + 4]) << 24) | (UInt32(superBlob[cdOffset + 5]) << 16)
            | (UInt32(superBlob[cdOffset + 6]) << 8) | UInt32(superBlob[cdOffset + 7]))
        let identOff = Int(
          (UInt32(superBlob[cdOffset + 20]) << 24) | (UInt32(superBlob[cdOffset + 21]) << 16)
            | (UInt32(superBlob[cdOffset + 22]) << 8) | UInt32(superBlob[cdOffset + 23]))
        var forged = superBlob
        forged[cdOffset + identOff] = forged[cdOffset + identOff] == 0x61 ? 0x62 : 0x61
        let forgedCD = forged.subdata(in: cdOffset..<(cdOffset + cdLen))
        let forgedHash = Data(SHA256.hash(data: forgedCD).prefix(20))
        #expect(
          ChromeRunningCodeSignature.verifySuperBlob(forged, expectedCDHash: forgedHash) == nil)
      }
    }

    // Local self-signed Debug app ("Atd Local Development") must fail Apple Root CA pinning.
    let debugApp = URL(filePath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appending(path: "DerivedData/Build/Products/Debug/Atd.app")
    if let execURL = Bundle(url: debugApp)?.executableURL,
      FileManager.default.fileExists(atPath: execURL.path(percentEncoded: false)),
      let superBlob = try Self.extractSuperBlob(from: execURL),
      let cdhash = ChromeCodeSignature.cdhash(ofCodeAt: debugApp)
    {
      #expect(ChromeRunningCodeSignature.verifySuperBlob(superBlob, expectedCDHash: cdhash) == nil)
    }

    // Live running Google Chrome (including updated-in-place errSecCSStaticCodeChanged processes)
    // must pass full kernel CS_OPS_BLOB + static bundle verification.
    for chrome in NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.google.Chrome")
    where chrome.processIdentifier > 0 && !chrome.isTerminated {
      let verified = ChromeBrowserSignature.verify(pid: chrome.processIdentifier)
      #expect(verified?.signingIdentifier == "com.google.Chrome")
      #expect(verified?.teamId == "EQHXZ8M8AV")
    }
  }
}
