import Darwin
import Foundation
import Testing

@testable import AICore

@Suite("InlineText64, Decision Rings, ProcessIdentity, and String Keys")
struct InlineDecisionRingTests {
  @Test(
    "InlineText64 has exact 64-byte size/stride, scalar-safe truncation, and active-byte Equatable")
  func inlineText64LayoutAndTruncation() {
    #expect(MemoryLayout<InlineText64>.size == 64)
    #expect(MemoryLayout<InlineText64>.stride == 64)
    #expect(MemoryLayout<InlineText64>.alignment == 8)

    let empty = InlineText64(nil)
    #expect(empty.isEmpty)
    #expect(empty.utf8Count == 0)
    #expect(!empty.isTruncated)
    #expect(empty.stringValue == "")

    let exact63 = String(repeating: "a", count: 63)
    let slot63 = InlineText64(truncatingUTF8: exact63)
    #expect(slot63.utf8Count == 63)
    #expect(!slot63.isTruncated)
    #expect(slot63.stringValue == exact63)

    let over64 = String(repeating: "b", count: 64)
    let slot64 = InlineText64(truncatingUTF8: over64)
    #expect(slot64.utf8Count == 63)
    #expect(slot64.isTruncated)
    #expect(slot64.stringValue.count == 63)

    // 20 ASCII bytes + fifteen 3-byte CJK scalars = 65 bytes (byte 63 lands inside a 3-byte scalar).
    let cjk = String(repeating: "x", count: 20) + String(repeating: "中", count: 15)
    let cjkSlot = InlineText64(truncatingUTF8: cjk)
    #expect(cjkSlot.isTruncated)
    #expect(cjkSlot.utf8Count == 62)  // 20 + 14 * 3 = 62 (backs up cleanly before 15th CJK char)
    #expect(!cjkSlot.stringValue.contains("\u{FFFD}"))

    // 61 ASCII bytes + 4-byte emoji = 65 bytes -> backs up to 61 bytes.
    let emoji = String(repeating: "z", count: 61) + "🚀"
    let emojiSlot = InlineText64(truncatingUTF8: emoji)
    #expect(emojiSlot.isTruncated)
    #expect(emojiSlot.utf8Count == 61)
    #expect(emojiSlot.stringValue == String(repeating: "z", count: 61))

    // Manual Equatable compares metadata byte 63 and only 0..<utf8Count active bytes.
    var dirtyA = InlineText64("com.google.Chrome")
    var dirtyB = InlineText64("com.google.Chrome")
    withUnsafeMutableBytes(of: &dirtyA) { $0[40] = 0xAA }
    withUnsafeMutableBytes(of: &dirtyB) { $0[40] = 0x55 }
    #expect(dirtyA == dirtyB)
    #expect(dirtyA != InlineText64("com.apple.Safari"))
  }

  @Test("All 4 ring entry types respect stride/total RAM caps, wraparound, and expectedSeq updates")
  func decisionRingStridesAndOperations() {
    #expect(MemoryLayout<SelectionDecisionEntry>.stride <= 128)
    #expect(MemoryLayout<HotKeyDecisionEntry>.stride <= 96)
    #expect(MemoryLayout<CaptureAndArbiterEntry>.stride <= 96)
    #expect(MemoryLayout<RelayAndSupervisorEntry>.stride <= 128)

    let totalBytes =
      64 * MemoryLayout<SelectionDecisionEntry>.stride
      + 64 * MemoryLayout<HotKeyDecisionEntry>.stride
      + 64 * MemoryLayout<CaptureAndArbiterEntry>.stride
      + 64 * MemoryLayout<RelayAndSupervisorEntry>.stride
    #expect(totalBytes < 32_768)

    let ring = SelectionDecisionRing(capacity: 64)
    var firstSlot = (slot: -1, seq: UInt32(0))
    for i in 0..<100 {
      var entry = SelectionDecisionEntry()
      entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
      entry.frontmostPid = Int32(1000 + i)
      entry.frontmostBundleId = InlineText64("com.google.Chrome")
      let recorded = ring.append(entry)
      if i == 0 { firstSlot = recorded }
    }

    // Slot 0 was overwritten when entry 64 arrived, so updating with expectedSeq == 1 must fail.
    let staleMutated = ring.update(slot: firstSlot.slot, expectedSeq: firstSlot.seq) {
      $0.dropStage = 99
    }
    #expect(!staleMutated)

    // Updating the latest entry with its live seq mutates in place without adding a new slot.
    var liveEntry = SelectionDecisionEntry()
    liveEntry.frontmostPid = 9999
    let live = ring.append(liveEntry)
    let liveMutated = ring.update(slot: live.slot, expectedSeq: live.seq) {
      $0.debounceState = 2
      $0.attempt1Outcome = 1
    }
    #expect(liveMutated)

    let snap = ring.snapshot()
    #expect(snap.capacity == 64)
    #expect(snap.totalRecorded == 101)
    #expect(snap.overwrittenCount == 37)
    #expect(snap.entries.count == 64)
    #expect(snap.entries.first?.seq == 38)
    #expect(snap.entries.last?.seq == 101)
    #expect(snap.entries.last?.debounceState == 2)
    #expect(snap.entries.last?.attempt1Outcome == 1)
  }

  @Test("10,000 hot-path InlineText64 + ring append/update operations stay within latency budget")
  func hotPathThroughput() {
    let ring = HotKeyDecisionRing(capacity: 64)
    let start = ContinuousClock.now
    for i in 0..<10_000 {
      var entry = HotKeyDecisionEntry()
      entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
      entry.subjectOrBundleId = InlineText64("company.thebrowser.Browser")
      entry.modifierFlagsMask = UInt32(i & 0xFF)
      let res = ring.append(entry)
      _ = ring.update(slot: res.slot, expectedSeq: res.seq) { $0.elapsedMs = 12 }
    }
    let elapsed = ContinuousClock.now - start
    #expect(elapsed < .milliseconds(50))
  }

  @Test("ShellDecisionRings JSON export anonymizes private bundle IDs via BundleIdentifierRedactor")
  func ringExportRedactsPrivateBundleIds() throws {
    let rings = ShellDecisionRings(capacity: 16)
    var safari = SelectionDecisionEntry()
    safari.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    safari.frontmostBundleId = InlineText64("com.apple.Safari")
    rings.selection.append(safari)

    var privateApp = SelectionDecisionEntry()
    privateApp.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    privateApp.frontmostBundleId = InlineText64("com.acme-internal.secret-tool")
    rings.selection.append(privateApp)

    let json = String(decoding: try rings.exportSelectionJSON(), as: UTF8.self)
    #expect(json.contains("com.apple.Safari"))
    #expect(!json.contains("acme-internal"))
    #expect(json.contains("app#"))
  }

  @Test("ProcessIdentity resolves symlinks, checks ancestry, and guards path boundaries")
  func processIdentityAndPlacement() throws {
    let myPid = getpid()
    #expect(ProcessIdentity.start(of: myPid) != nil)
    #expect(ProcessIdentity.start(of: -1) == nil)
    let myExec = try #require(ProcessIdentity.executablePath(of: myPid))
    let execURL = URL(filePath: myExec)
    let parentDir = execURL.deletingLastPathComponent()

    #expect(ProcessIdentity.isProcess(myPid, inside: parentDir))
    // Sibling prefix collision check: `/dir` must NEVER match `/dir-other/bin`.
    #expect(
      !ProcessIdentity.isExecutable(
        "/Applications/Atd.app-copy/Contents/MacOS/Atd",
        inside: URL(filePath: "/Applications/Atd.app"))
    )

    // Symlink normalization (`/var/folders/...` symlink -> `/private/var/folders/...`).
    let tempRoot = FileManager.default.temporaryDirectory.appending(
      path: "pid-ident-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempRoot) }
    let realBundle = tempRoot.appending(path: "Real/Atd.app", directoryHint: .isDirectory)
    let nodeExec = realBundle.appending(path: "Contents/Resources/node/bin/node")
    try FileManager.default.createDirectory(
      at: nodeExec.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data().write(to: nodeExec)
    let symlinkBundle = tempRoot.appending(path: "LinkAtd.app")
    try FileManager.default.createSymbolicLink(at: symlinkBundle, withDestinationURL: realBundle)
    #expect(
      ProcessIdentity.isExecutable(nodeExec.path(percentEncoded: false), inside: symlinkBundle))

    #expect(ProcessIdentity.isDescendant(myPid, of: myPid))
    if let ppid = ProcessIdentity.parentPid(of: myPid), ppid > 1 {
      #expect(ProcessIdentity.isDescendant(myPid, of: ppid))
    }

    let home = "/Users/" + "user"
    #expect(
      DiagnosticsEnvironmentRecord.BundlePlacementRecord.classifyLocation(
        bundlePath: "/Applications/Atd.app", homePath: home) == "system_applications")
    #expect(
      DiagnosticsEnvironmentRecord.BundlePlacementRecord.classifyLocation(
        bundlePath: home + "/Downloads/Atd.app", homePath: home) == "downloads")
    #expect(
      DiagnosticsEnvironmentRecord.BundlePlacementRecord.classifyLocation(
        bundlePath: "/Volumes/Atd/Atd.app", homePath: home) == "volumes_dmg")
  }

  @Test(
    "DiagnosticsStringKey covers all 18 catalog keys and no debug ingest port remains in Sources")
  func stringKeysAndNoDebugCollector() throws {
    #expect(DiagnosticsStringKey.allCases.count == 18)
    #expect(DiagnosticsStringKey.exportPanelAlreadyOpen == .exportPanelBusy)

    let sourcesRoot = URL(filePath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appending(path: "Sources", directoryHint: .isDirectory)
    let enumerator = FileManager.default.enumerator(
      at: sourcesRoot, includingPropertiesForKeys: [.isRegularFileKey])
    let bannedPort = "571" + "26"
    let bannedType = "LongScreenshot" + "DebugLog"
    while let fileURL = enumerator?.nextObject() as? URL {
      guard fileURL.pathExtension == "swift",
        let content = try? String(contentsOf: fileURL, encoding: .utf8)
      else { continue }
      #expect(!content.contains(bannedPort), "Found debug port in \(fileURL.lastPathComponent)")
      #expect(!content.contains(bannedType), "Found debug log in \(fileURL.lastPathComponent)")
    }
  }
}
