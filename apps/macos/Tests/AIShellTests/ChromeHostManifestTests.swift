import AICore
import Darwin
import Foundation
import Testing

@testable import AIShell

@Suite("ChromeHostDiscovery and ChromeHostManifest")
struct ChromeHostManifestTests {
  private static let identity = ChromeChannelIdentity(
    hostName: "com.junerdd.atd.chrome.dev",
    extensionId: "eolengaocpdgjapbjdfpfcokjpgjaedi")!

  private struct Sandbox {
    let root: URL
    let home: URL
    let appSupport: URL
    let hostExecutable: URL
    let appBundle: URL

    init() throws {
      root = FileManager.default.temporaryDirectory
        .appending(path: "atd-chrome-manifest-\(UUID().uuidString)", directoryHint: .isDirectory)
      home = root.appending(path: "home", directoryHint: .isDirectory)
      appSupport = home.appending(path: "Library/Application Support", directoryHint: .isDirectory)
      hostExecutable = root.appending(path: "atd-chrome-host", directoryHint: .notDirectory)
      appBundle = root.appending(path: "Applications/Atd.app", directoryHint: .isDirectory)
      try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(at: appBundle, withIntermediateDirectories: true)
      try Data("#!/bin/sh\nexit 0\n".utf8).write(to: hostExecutable)
      chmod(hostExecutable.path(percentEncoded: false), 0o755)
    }

    func cleanup() {
      try? FileManager.default.removeItem(at: root)
    }

    func mkdir(_ relative: String) throws -> URL {
      let dir = appSupport.appending(path: relative, directoryHint: .isDirectory)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return dir
    }

    func writeJSON(_ object: [String: Any], to relative: String) throws {
      let file = appSupport.appending(path: relative, directoryHint: .notDirectory)
      try FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      let data = try JSONSerialization.data(withJSONObject: object)
      try data.write(to: file)
    }

    func manifestURL(in relativeDir: String) -> URL {
      appSupport.appending(path: relativeDir, directoryHint: .isDirectory)
        .appending(path: "NativeMessagingHosts", directoryHint: .isDirectory)
        .appending(path: "\(ChromeHostManifestTests.identity.hostName).json")
    }
  }

  @Test("Curated active-profile gate skips phantom folders and deduplicates/sorts browsers")
  func curatedActiveProfileGateAndDedup() throws {
    let box = try Sandbox()
    defer { box.cleanup() }

    // Phantom folder: only NativeMessagingHosts, no Local State or Default preferences.
    _ = try box.mkdir("BraveSoftware/Brave-Browser/NativeMessagingHosts")
    // Curated with Local State containing profile dictionary.
    try box.writeJSON(
      ["profile": ["info_cache": ["Default": [:]]]], to: "Google/Chrome/Local State")
    // Curated with Default/Secure Preferences only.
    try box.writeJSON([:], to: "Aside/Default/Secure Preferences")
    // Curated with Default/Preferences only.
    try box.writeJSON([:], to: "Arc/User Data/Default/Preferences")
    // Two curated locations mapping to the same display name ("ChatGPT Atlas").
    try box.writeJSON(["profile": [:]], to: "OpenAI/ChatGPT Atlas/Local State")
    try box.writeJSON(["profile": [:]], to: "com.openai.atlas/browser-data/host/Local State")
    // Invalid Local State (missing "profile" dict, like Electron uninstall_metrics).
    try box.writeJSON(["uninstall_metrics": [:]], to: "Vivaldi/Local State")

    let result = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)

    #expect(result.status == .installed)
    #expect(result.browsers == ["Arc", "Aside", "ChatGPT Atlas", "Google Chrome"])
    #expect(
      FileManager.default.fileExists(
        atPath: box.manifestURL(in: "Google/Chrome").path(percentEncoded: false)))
    #expect(
      FileManager.default.fileExists(
        atPath: box.manifestURL(in: "Aside").path(percentEncoded: false)))
    #expect(
      FileManager.default.fileExists(
        atPath: box.manifestURL(in: "Arc/User Data").path(percentEncoded: false)))
    #expect(
      FileManager.default.fileExists(
        atPath: box.manifestURL(in: "OpenAI/ChatGPT Atlas").path(percentEncoded: false)))
    #expect(
      FileManager.default.fileExists(
        atPath: box.manifestURL(in: "com.openai.atlas/browser-data/host").path(
          percentEncoded: false)
      ))
    #expect(
      !FileManager.default.fileExists(
        atPath: box.manifestURL(in: "BraveSoftware/Brave-Browser").path(percentEncoded: false)))
    #expect(
      !FileManager.default.fileExists(
        atPath: box.manifestURL(in: "Vivaldi").path(percentEncoded: false)))
  }

  @Test("Dynamic discovery detects unknown forks via Local Extension Settings and Preferences")
  func dynamicDiscoveryRequiresExtensionPresence() throws {
    let box = try Sandbox()
    defer { box.cleanup() }
    let extId = Self.identity.extensionId

    // Depth-1 fork detected via Local Extension Settings/<extId>.
    try box.writeJSON(["profile": ["info_cache": ["Default": [:]]]], to: "OrionFork/Local State")
    _ = try box.mkdir("OrionFork/Default/Local Extension Settings/\(extId)")

    // Depth-2 fork ("User Data" uses parent folder name) detected via Secure Preferences.
    try box.writeJSON(
      ["profile": ["info_cache": ["Profile 1": [:]]]], to: "Nebula/User Data/Local State")
    try box.writeJSON(
      ["extensions": ["settings": [extId: ["state": 1]]]],
      to: "Nebula/User Data/Profile 1/Secure Preferences")

    // Depth-2 fork detected via Preferences.
    try box.writeJSON(
      ["profile": ["info_cache": ["Default": [:]]]], to: "Acme/ForkTwo/Local State")
    try box.writeJSON(
      ["extensions": ["settings": [extId: ["state": 1]]]],
      to: "Acme/ForkTwo/Default/Preferences")

    // Fork with Local State + extensionId only in an unrelated string (not extensions.settings).
    try box.writeJSON(["profile": ["info_cache": ["Default": [:]]]], to: "DecoyFork/Local State")
    try box.writeJSON(["notes": extId], to: "DecoyFork/Default/Preferences")

    // Fork with path-traversal profile key in info_cache must be rejected.
    try box.writeJSON(
      ["profile": ["info_cache": ["../OrionFork/Default": [:]]]],
      to: "TraversalFork/Local State")

    let result = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)

    #expect(result.status == .installed)
    #expect(result.browsers == ["ForkTwo", "Nebula", "OrionFork"])
    #expect(
      !FileManager.default.fileExists(
        atPath: box.manifestURL(in: "DecoyFork").path(percentEncoded: false)))
    #expect(
      !FileManager.default.fileExists(
        atPath: box.manifestURL(in: "TraversalFork").path(percentEncoded: false)))
  }

  @Test("Electron, Gecko, Atd, Apple, and Chrome for Testing folders are strictly excluded")
  func hardExclusionsNeverReceiveManifests() throws {
    let box = try Sandbox()
    defer { box.cleanup() }
    let extId = Self.identity.extensionId

    let excludedDirs = [
      "LarkShell", "Notion", "Code", "Cursor", "Claude", "Firefox", "zen",
      "AgentService Dev", "com.junerdd.ai.dev", "com.apple.Safari", "Atd", "Atd Development",
      "Google/Chrome for Testing", "Google/ChromeForTesting", "Google/Chrome-headless",
      "OpenAI/Codex",
    ]
    for dir in excludedDirs {
      try box.writeJSON(["profile": ["info_cache": ["Default": [:]]]], to: "\(dir)/Local State")
      _ = try box.mkdir("\(dir)/Default/Local Extension Settings/\(extId)")
    }

    let result = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)

    #expect(result.status == .chromeMissing)
    #expect(result.browsers.isEmpty)
    for dir in excludedDirs {
      #expect(
        !FileManager.default.fileExists(
          atPath: box.manifestURL(in: dir).path(percentEncoded: false)),
        "Excluded folder \(dir) must not receive a manifest")
    }
  }

  @Test("Symlinked curated and dynamic directories are ignored")
  func symlinksExcluded() throws {
    let box = try Sandbox()
    defer { box.cleanup() }
    let extId = Self.identity.extensionId

    // Real target outside Application Support.
    let target = box.root.appending(path: "outside-browser", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: target.appending(path: "Default/Local Extension Settings/\(extId)"),
      withIntermediateDirectories: true)
    let localState = try JSONSerialization.data(
      withJSONObject: ["profile": ["info_cache": ["Default": [:]]]])
    try localState.write(to: target.appending(path: "Local State"))

    // Symlink at curated path, intermediate curated parent, and dynamic depth-1 path.
    try FileManager.default.createSymbolicLink(
      at: box.appSupport.appending(path: "Vivaldi"), withDestinationURL: target)
    let braveParent = box.root.appending(path: "outside-brave", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: braveParent.appending(path: "Brave-Browser"), withIntermediateDirectories: true)
    try localState.write(to: braveParent.appending(path: "Brave-Browser/Local State"))
    try FileManager.default.createSymbolicLink(
      at: box.appSupport.appending(path: "BraveSoftware"), withDestinationURL: braveParent)
    try FileManager.default.createSymbolicLink(
      at: box.appSupport.appending(path: "LinkedFork"), withDestinationURL: target)

    let result = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)

    #expect(result.status == .chromeMissing)
    #expect(result.browsers.isEmpty)
    #expect(
      !FileManager.default.fileExists(
        atPath: target.appending(path: "NativeMessagingHosts").path(percentEncoded: false)))
  }

  @Test("Blocked home locations, missing host binary, and idempotent writes behave accurately")
  func blockedLocationAndIdempotentWrites() throws {
    let box = try Sandbox()
    defer { box.cleanup() }
    try box.writeJSON(["profile": [:]], to: "Aside/Local State")

    // Running from Downloads is blocked and writes no manifest.
    let downloadsApp = box.home.appending(path: "Downloads/Atd.app", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: downloadsApp, withIntermediateDirectories: true)
    let blocked = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: downloadsApp, home: box.home)
    #expect(blocked == .init(status: .blockedLocation, browsers: []))
    #expect(
      !FileManager.default.fileExists(
        atPath: box.manifestURL(in: "Aside").path(percentEncoded: false)))

    // Missing host executable returns failed.
    let missing = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: nil,
      bundleURL: box.appBundle, home: box.home)
    #expect(missing == .init(status: .failed, browsers: []))

    // First valid install writes manifest; sibling unrelated manifest stays untouched.
    let sibling = box.appSupport.appending(path: "Aside/NativeMessagingHosts/other.host.json")
    try FileManager.default.createDirectory(
      at: sibling.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{\"name\":\"other\"}\n".utf8).write(to: sibling)

    let first = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)
    #expect(first == .init(status: .installed, browsers: ["Aside"]))

    let manifestFile = box.manifestURL(in: "Aside")
    var beforeStat = stat()
    #expect(stat(manifestFile.path(percentEncoded: false), &beforeStat) == 0)

    // Second install with identical content preserves inode (does not rewrite).
    let second = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)
    #expect(second == .init(status: .installed, browsers: ["Aside"]))

    var afterStat = stat()
    #expect(stat(manifestFile.path(percentEncoded: false), &afterStat) == 0)
    #expect(beforeStat.st_ino == afterStat.st_ino)
    #expect(try Data(contentsOf: sibling) == Data("{\"name\":\"other\"}\n".utf8))
  }

  @Test(
    "write refuses symlinked NativeMessagingHosts dir or manifest file and replaces >64 KiB file")
  func writeRejectsSymlinksAndReplacesOversizedRegularFile() throws {
    let box = try Sandbox()
    defer { box.cleanup() }

    let outsideDir = box.root.appending(path: "outside-hosts", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: outsideDir, withIntermediateDirectories: true)
    let outsideTargetFile = box.root.appending(
      path: "outside-target.json", directoryHint: .notDirectory)
    try Data("ORIGINAL".utf8).write(to: outsideTargetFile)

    // 1. Symlinked NativeMessagingHosts directory must be refused without escaping.
    try box.writeJSON(["profile": [:]], to: "Aside/Local State")
    try FileManager.default.createSymbolicLink(
      at: box.appSupport.appending(path: "Aside/NativeMessagingHosts"),
      withDestinationURL: outsideDir)
    let dirEscape = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)
    #expect(dirEscape == .init(status: .failed, browsers: []))
    #expect(
      !FileManager.default.fileExists(
        atPath: outsideDir.appending(path: "\(Self.identity.hostName).json")
          .path(percentEncoded: false)))

    // 2. Real NativeMessagingHosts directory with symlinked <hostName>.json must be refused.
    try FileManager.default.removeItem(
      at: box.appSupport.appending(path: "Aside/NativeMessagingHosts"))
    _ = try box.mkdir("Aside/NativeMessagingHosts")
    let manifestFile = box.manifestURL(in: "Aside")
    try FileManager.default.createSymbolicLink(
      at: manifestFile, withDestinationURL: outsideTargetFile)
    let fileEscape = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)
    #expect(fileEscape == .init(status: .failed, browsers: []))
    #expect(try Data(contentsOf: outsideTargetFile) == Data("ORIGINAL".utf8))

    // 3. Oversized (> 64 KiB) regular manifest file is replaced atomically without reading it.
    try FileManager.default.removeItem(at: manifestFile)
    try Data(repeating: 0x41, count: 96 * 1024).write(to: manifestFile)
    let replaced = ChromeHostManifest.install(
      identity: Self.identity, hostExecutable: box.hostExecutable,
      bundleURL: box.appBundle, home: box.home)
    #expect(replaced == .init(status: .installed, browsers: ["Aside"]))
    let expected = try ChromeHostManifest.contents(
      identity: Self.identity, hostPath: box.hostExecutable.path(percentEncoded: false))
    #expect(try Data(contentsOf: manifestFile) == expected)
  }
}
