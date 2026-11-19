import Foundation
import Testing

@testable import AICore

@Suite("DiagnosticsBundleBuilder, Hard-Excludes, Tail Alignment, and IpsCrashSummarizer")
struct DiagnosticsBundleAndIpsTests {
  private static var testAnchors: DiagnosticsScrubber.EnvironmentAnchors {
    DiagnosticsScrubber.EnvironmentAnchors(
      homePaths: ["/Users/" + "alicecorp"],
      tmpPaths: ["/private/var/folders/ab/cd1234/T"],
      usernames: ["alicecorp"],
      hostnames: ["corpbox"])
  }

  @Test("DiagnosticsPathPolicy enforces allowlist archive entries and hard-excludes private stores")
  func hardExcludesAndArchiveAllowlist() {
    let base = "/Users/" + "alicecorp" + "/Library/Application Support/AgentService"
    for forbidden in [
      "\(base)/auth/token",
      "\(base)/ledger.json",
      "\(base)/ledger.json.tmp",
      "\(base)/audit/2026-11.jsonl",
      "\(base)/agent/sessions/task-1/session.jsonl",
      "\(base)/agent/memory/index.db",
      "\(base)/agent/memory/index.db-wal",
      "\(base)/memory/notes.md",
      "\(base)/resources/file.png",
      "\(base)/extractions/doc.txt",
      "\(base)/tasks/t1/out.txt",
      "\(base)/atd/skills/my-skill/SKILL.md",
      "/Users/" + "alicecorp" + "/.atd/agents/custom.md",
      "/Users/" + "alicecorp" + "/Desktop/note.txt",
      "/Users/" + "alicecorp" + "/Documents/report.pdf",
      "/Users/" + "alicecorp" + "/Downloads/Atd.dmg",
      "/Users/" + "alicecorp" + "/Library/Mobile Documents/com~apple~CloudDocs/a.txt",
      "/repo/.env.local",
      "/repo/.dev.vars",
      "/repo/.local/project-context.json",
      "/repo/wrangler.local.jsonc",
    ] {
      #expect(
        DiagnosticsPathPolicy.isHardExcludedPathString(forbidden), "Expected \(forbidden) excluded")
    }

    // Legitimate log paths must NOT be excluded.
    #expect(
      !DiagnosticsPathPolicy.isHardExcludedPathString("\(base)/computer/atd-computer-driver.log"))
    #expect(
      !DiagnosticsPathPolicy.isHardExcludedPathString("\(base)/computer/browser-workers/prof1.log"))
    #expect(
      !DiagnosticsPathPolicy.isHardExcludedPathString(
        "/Users/" + "alicecorp" + "/Library/Logs/AI/shell.log"))

    #expect(DiagnosticsPathPolicy.isAllowedArchiveEntry("manifest.json"))
    #expect(DiagnosticsPathPolicy.isAllowedArchiveEntry("decision-rings/selection.json"))
    #expect(!DiagnosticsPathPolicy.isAllowedArchiveEntry("../manifest.json"))
    #expect(!DiagnosticsPathPolicy.isAllowedArchiveEntry("/manifest.json"))
    #expect(!DiagnosticsPathPolicy.isAllowedArchiveEntry("auth/token"))
  }

  @Test("readTailSlice aligns to newline in first 4KiB and preserves overlong newline-free dumps")
  func tailSeekAlignmentAndNewlineFreeDefense() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "tail-slice-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    // 1) Normal multi-line log larger than cap -> drops broken leading line cleanly.
    let multiURL = tempDir.appending(path: "service.log")
    let repeatedLines = (0..<400).map { "line-\($0)-payload-0123456789\n" }.joined()
    try Data(repeatedLines.utf8).write(to: multiURL)
    let multiSlice = try #require(
      DiagnosticsBundleBuilder.readTailSlice(of: multiURL, maxBytes: 1_024))
    let multiText = String(decoding: multiSlice, as: UTF8.self)
    #expect(multiText.hasPrefix("line-"))
    #expect(multiSlice.count <= 1_024)

    // 2) 600 KiB single-line NO-NEWLINE CJK dump -> must NOT drop entire 512 KiB tail!
    let singleURL = tempDir.appending(path: "single.log")
    let hugeNoNewline = String(repeating: "中", count: 205_000)  // 615,000 UTF-8 bytes, zero '\n'
    try Data(hugeNoNewline.utf8).write(to: singleURL)
    let singleSlice = try #require(
      DiagnosticsBundleBuilder.readTailSlice(
        of: singleURL, maxBytes: DiagnosticsBundleBuilder.shellTailPerFileBytes))
    #expect(singleSlice.count >= DiagnosticsBundleBuilder.shellTailPerFileBytes - 3)
    let singleDecoded = String(decoding: singleSlice, as: UTF8.self)
    #expect(!singleDecoded.isEmpty)
    #expect(!singleDecoded.hasPrefix("\u{FFFD}"))
  }

  @Test("Zero-disk preview obeys 128KiB/16KiB caps, and ditto zip export scrubs & cleans temp dir")
  func previewAndZipExport() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "bundle-build-\(UUID().uuidString)", directoryHint: .isDirectory)
    let stagingParent = tempDir.appending(path: "staging-parent", directoryHint: .isDirectory)
    let dataDir = tempDir.appending(path: "AgentService", directoryHint: .isDirectory)
    let logsDir = tempDir.appending(path: "Logs", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: stagingParent, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: dataDir.appending(path: "computer/browser-workers"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let secretKey = ["sk", "proj", String(repeating: "Qv7m", count: 6)].joined(separator: "-")
    let userPath = "/Users/" + "alicecorp" + "/Documents/PrivatePlan.md"
    try Data(#"{"ts":"t1","msg":"shell path \#(userPath)"}"#.utf8 + [0x0A]).write(
      to: logsDir.appending(path: "shell.log"))
    try Data(#"{"ts":"t2","msg":"svc key \#(secretKey)"}"#.utf8 + [0x0A]).write(
      to: logsDir.appending(path: "service.log"))
    try Data(("driver boot " + String(repeating: "D", count: 24_000) + "\n").utf8).write(
      to: dataDir.appending(path: "computer/atd-computer-driver.log"))
    try Data("worker url https://corpbox.internal.local/login?code=abc123\n".utf8).write(
      to: dataDir.appending(path: "computer/browser-workers/personal-profile.log"))

    let snapJson = try JSONSerialization.data(withJSONObject: [
      "schemaVersion": 1,
      "boundedLogRing": ["lines": [#"{"ts":"t3","msg":"ring line \#(userPath)"}"#]],
      "runPrepDecisionRing": ["capacity": 32, "droppedCount": 0, "entries": []],
    ])
    let bigDoctor = try JSONSerialization.data(withJSONObject: [
      "padding": String(repeating: "P", count: 150_000)
    ])

    let builder = DiagnosticsBundleBuilder()
    let inputs = DiagnosticsBundleBuilder.Inputs(
      triggerSurface: .menu,
      isDevelopment: false,
      includeCrashSummaries: false,
      generatedAt: Date(timeIntervalSince1970: 1_763_447_763),
      doctorReportJSON: bigDoctor,
      serviceSnapshotJSON: snapJson,
      decisionRings: ShellDecisionRings(capacity: 16),
      shellLogFileURL: logsDir.appending(path: "shell.log"),
      serviceLogDirectoryURL: logsDir,
      dataDirectoryURL: dataDir,
      anchors: Self.testAnchors)

    // 1) Preview writes ZERO files into stagingParent and caps total excerpts <= 128 KiB.
    let preview = try builder.preview(inputs: inputs)
    let afterPreviewItems = try FileManager.default.contentsOfDirectory(
      atPath: stagingParent.path(percentEncoded: false))
    #expect(afterPreviewItems.isEmpty)
    var cumulativeExcerptBytes = 0
    for file in preview.files {
      if let ex = file.previewExcerpt {
        #expect(ex.utf8.count <= DiagnosticsBundleBuilder.maxPreviewFileBytes)
        cumulativeExcerptBytes += ex.utf8.count
        #expect(!ex.contains(secretKey))
        #expect(!ex.contains("alicecorp"))
      }
    }
    #expect(cumulativeExcerptBytes <= DiagnosticsBundleBuilder.maxPreviewTotalBytes)
    #expect(
      preview.files.first(where: { $0.path == "crashes/summary.json" })?.status
        == .omittedNotOptedIn)

    // 2) Export zip via /usr/bin/ditto and confirm staging directory was removed by defer.
    let outZip = tempDir.appending(path: preview.suggestedFileName)
    let archived = try builder.buildZipArchive(
      inputs: inputs, destinationZipURL: outZip, temporaryParent: stagingParent)
    #expect(archived.archiveBytes > 0)
    let leftoverStaging = try FileManager.default.contentsOfDirectory(
      atPath: stagingParent.path(percentEncoded: false))
    #expect(leftoverStaging.isEmpty)

    // Read zip contents in memory via `/usr/bin/unzip -p` and verify redaction & manifest.
    let unzip = Process()
    let pipe = Pipe()
    unzip.executableURL = URL(filePath: "/usr/bin/unzip")
    unzip.arguments = ["-p", outZip.path(percentEncoded: false)]
    unzip.standardOutput = pipe
    try unzip.run()
    let allExtracted = pipe.fileHandleForReading.readDataToEndOfFile()
    unzip.waitUntilExit()
    #expect(unzip.terminationStatus == 0)
    let extractedString = String(decoding: allExtracted, as: UTF8.self)
    #expect(!extractedString.contains(secretKey))
    #expect(!extractedString.contains("alicecorp"))
    #expect(!extractedString.contains("personal-profile"))
    #expect(extractedString.contains("profile-"))
  }

  @Test(
    "IpsCrashSummarizer strictly respects opt-in and filters usedImages[imageIndex].name without paths"
  )
  func ipsCrashSummarizerOptInAndAllowlist() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "ips-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let privatePath = "/Users/" + "alicecorp" + "/Projects/Atd.app/Contents/MacOS/Atd"
    let header = #"{"app_name":"Atd","timestamp":"2026-11-18 06:00:00.00 +0000","bug_type":"309"}"#
    let bodyObj: [String: Any] = [
      "procName": "Atd",
      "captureTime": "2026-11-18 06:00:00.00 +0000",
      "exception": ["type": "EXC_BAD_ACCESS", "signal": "SIGSEGV"],
      "asi": ["libsystem_c.dylib": ["abort() in " + privatePath]],
      "faultingThread": 0,
      "usedImages": [
        ["name": "Atd", "path": privatePath],
        ["name": "AIShell", "path": privatePath],
        ["name": "AIMac", "path": privatePath],
        ["name": "CoreFoundation", "path": "/System/Library/Frameworks/CoreFoundation"],
      ],
      "threads": [
        [
          "frames": [
            ["imageIndex": 0, "imageOffset": 4096, "symbolLocation": 32],
            ["imageIndex": 1, "imageOffset": 8192],
            ["imageIndex": 2, "imageOffset": 1024],  // AIMac excluded (package name, not image)
            ["imageIndex": 3, "imageOffset": 9999],  // CoreFoundation excluded
          ]
        ]
      ],
    ]
    let bodyData = try JSONSerialization.data(withJSONObject: bodyObj)
    var ipsRaw = Data((header + "\n").utf8)
    ipsRaw.append(bodyData)
    let ipsFile = tempDir.appending(path: "Atd-2026-11-18-060000.ips")
    try ipsRaw.write(to: ipsFile)

    // Opted out: never reads directory, returns .notOptedIn immediately.
    #expect(IpsCrashSummarizer.summarize(optedIn: false, reportsDirectory: tempDir) == .notOptedIn)

    // Opted in: extracts only Atd and AIShell frames, never copies `usedImages[].path` or `asi`.
    let optedIn = IpsCrashSummarizer.summarize(
      optedIn: true, reportsDirectory: tempDir, now: Date(), anchors: Self.testAnchors)
    guard case .scrubbed(.included(let summaryBytes, _, _, _)) = optedIn else {
      Issue.record("Expected opted-in IPS summary to succeed")
      return
    }
    let summaryText = String(decoding: summaryBytes, as: UTF8.self)
    #expect(!summaryText.contains("alicecorp"))
    #expect(!summaryText.contains("Projects"))
    #expect(!summaryText.contains("abort()"))
    let decoded = try JSONDecoder().decode(
      IpsCrashSummarizer.SummaryDocument.self, from: summaryBytes)
    #expect(decoded.crashReports.count == 1)
    let frames = try #require(decoded.crashReports.first?.appFrames)
    #expect(frames.map(\.imageName) == ["Atd", "AIShell"])
    #expect(frames.map(\.imageOffset) == [4096, 8192])
  }
}
