import Foundation
import Testing

@testable import AICore

@Suite("IpsCrashSummarizer >512KiB & DiagnosticsPathPolicy Anchoring Regressions (B14, B15)")
struct DiagnosticsBugbotRegressionTests {
  private static var testAnchors: DiagnosticsScrubber.EnvironmentAnchors {
    DiagnosticsScrubber.EnvironmentAnchors(
      homePaths: ["/Users/" + "alicecorp"],
      tmpPaths: ["/private/var/folders/ab/cd1234/T"],
      usernames: ["alicecorp"],
      hostnames: ["corpbox"])
  }

  @Test("B14: Summarizes >512KiB .ips v2 reports and reports omittedSizeCap when all >8MiB")
  func ipsLargeReportParsingAndOversizedStatus() throws {
    let fm = FileManager.default
    let tempDir = fm.temporaryDirectory.appending(
      path: "ips-b14-\(UUID().uuidString)", directoryHint: .isDirectory)
    try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: tempDir) }

    // 1) Construct a realistic ~850 KiB `.ips` v2 report (> old 512 KiB limit) with 550 usedImages.
    let privateBinPath = "/Users/" + "alicecorp" + "/Applications/Atd.app/Contents/MacOS/Atd"
    var usedImages: [[String: Any]] = [
      ["name": "Atd", "path": privateBinPath, "uuid": "00000000-0000-0000-0000-000000000001"],
      ["name": "AICore", "path": privateBinPath, "uuid": "00000000-0000-0000-0000-000000000002"],
    ]
    let dylibPath = "/System/Library/PrivateFrameworks/" + String(repeating: "Framework", count: 14)
    for idx in 0..<1_800 {
      usedImages.append([
        "name": "SysDylib\(idx)",
        "path": "\(dylibPath)/SysDylib\(idx).dylib",
        "base": 0x1_8000_0000 + idx * 0x10000,
        "size": 65536,
        "uuid": "11111111-2222-3333-4444-\(String(format: "%012d", idx))",
      ])
    }
    let header = #"{"app_name":"Atd","timestamp":"2026-11-18 10:00:00.00 +0000","bug_type":"309"}"#
    let bodyObj: [String: Any] = [
      "procName": "Atd",
      "captureTime": "2026-11-18 10:00:00.00 +0000",
      "exception": ["type": "EXC_CRASH", "signal": "SIGABRT"],
      "faultingThread": 0,
      "usedImages": usedImages,
      "threads": (0..<24).map { tIdx in
        [
          "id": tIdx,
          "frames": (0..<30).map { fIdx in
            [
              "imageIndex": (tIdx == 0 && fIdx < 2) ? fIdx : (2 + ((tIdx * 30 + fIdx) % 500)),
              "imageOffset": 4096 + fIdx * 16,
              "symbolLocation": 16,
            ]
          },
        ]
      },
    ]
    let bodyData = try JSONSerialization.data(withJSONObject: bodyObj, options: [.prettyPrinted])
    var largeIps = Data((header + "\n").utf8)
    largeIps.append(bodyData)
    #expect(largeIps.count > 524_288)
    #expect(largeIps.count < IpsCrashSummarizer.maxInputReportBytes)

    let validURL = tempDir.appending(path: "Atd-2026-11-18-100000.ips")
    try largeIps.write(to: validURL)

    let outcome = IpsCrashSummarizer.summarize(
      optedIn: true, reportsDirectory: tempDir, now: Date(), anchors: Self.testAnchors)
    guard case .scrubbed(.included(let bytes, _, _, _)) = outcome else {
      Issue.record("Expected >512KiB .ips report to be included, got \(outcome)")
      return
    }
    let text = String(decoding: bytes, as: UTF8.self)
    #expect(!text.contains("alicecorp"))
    #expect(!text.contains("PrivateFrameworks"))
    let doc = try JSONDecoder().decode(IpsCrashSummarizer.SummaryDocument.self, from: bytes)
    #expect(doc.crashReports.count == 1)
    #expect(doc.crashReports.first?.appFrames.map(\.imageName) == ["Atd", "AICore"])

    // 2) Replace with an oversized (> 8 MiB) `.ips` file -> must surface `.omittedSizeCap`.
    try fm.removeItem(at: validURL)
    let oversizedURL = tempDir.appending(path: "Atd-2026-11-18-110000.ips")
    let oversizedBytes = Data(repeating: 0x20, count: IpsCrashSummarizer.maxInputReportBytes + 1024)
    try oversizedBytes.write(to: oversizedURL)

    let oversizedOutcome = IpsCrashSummarizer.summarize(
      optedIn: true, reportsDirectory: tempDir, now: Date(), anchors: Self.testAnchors)
    if case .scrubbed(.omitted(let status, let code, _)) = oversizedOutcome {
      #expect(status == .omittedSizeCap)
      #expect(code == .stagingCapExceeded)
    } else {
      Issue.record(
        "Expected >8MiB-only .ips directory to return .omittedSizeCap: \(oversizedOutcome)")
    }
  }

  @Test("B15: Anchors Folder-TCC and private data-store exclusions without rejecting usernames/tmp")
  func pathPolicyAnchoringForUsernamesAndCustomDataDirs() throws {
    let syntheticHome = "/Users/" + "alicecorp"
    // Valid diagnostic paths whose username or ancestor temp folder matches a store/TCC word.
    let allowedPaths = [
      "/Users/documents/Library/Logs/AI/shell.log",
      "/Users/desktop/Library/Logs/AI/shell.log",
      "/Users/downloads/Library/Logs/AI/shell.log",
      "/Users/atd/Library/Logs/AI/service.log",
      "/Users/atd/Library/Application Support/AgentService",
      "/Users/tasks/Library/Logs/AI/shell.log",
      "/Users/memory/Library/Logs/AI/shell.log",
      "/Users/resources/Library/Logs/AI/shell.log",
      "/Users/extractions/Library/Logs/AI/shell.log",
      "/tmp/atd/AgentService/logs/service.log",
      "/tmp/tasks/AgentService Dev/computer/atd-computer-driver.log",
    ]
    for path in allowedPaths {
      #expect(
        !DiagnosticsPathPolicy.isHardExcludedPathString(path, homeDirectoryPath: syntheticHome),
        "Expected valid diagnostic path NOT excluded: \(path)")
    }

    // Folder-TCC & AgentService*/custom dataDirectory exclusions must still hold strictly.
    let customDataDir = "/tmp/atd/custom-data-root"
    let excludedPaths = [
      "/Users/alicecorp/Documents/report.pdf",
      "/Users/atd/Documents/secret.txt",
      "/Users/documents/Documents/private.md",
      "/Users/atd/Library/Mobile Documents/com~apple~CloudDocs/doc.txt",
      "/Users/atd/Library/Application Support/AgentService Dev/memory/notes.md",
      "/Users/atd/Library/Application Support/AgentService Dev/atd/skills/s/SKILL.md",
      "\(customDataDir)/memory/notes.md",
      "\(customDataDir)/resources/img.png",
      "\(customDataDir)/extractions/out.txt",
      "\(customDataDir)/tasks/t1/run.json",
      "\(customDataDir)/atd/agents/a.md",
    ]
    for path in excludedPaths {
      #expect(
        DiagnosticsPathPolicy.isHardExcludedPathString(
          path, dataDirectoryPath: customDataDir, homeDirectoryPath: syntheticHome),
        "Expected sensitive path excluded: \(path)")
    }
    #expect(
      !DiagnosticsPathPolicy.isHardExcludedPathString(
        "\(customDataDir)/logs/service.log",
        dataDirectoryPath: customDataDir,
        homeDirectoryPath: syntheticHome))

    // End-to-end bundle preview under an `/atd/` parent directory includes logs & blocks `<dataDir>/memory`.
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appending(
      path: "atd/b15-\(UUID().uuidString)/custom-data", directoryHint: .isDirectory)
    try fm.createDirectory(at: root.appending(path: "logs"), withIntermediateDirectories: true)
    try fm.createDirectory(at: root.appending(path: "memory"), withIntermediateDirectories: true)
    defer {
      try? fm.removeItem(at: root.deletingLastPathComponent().deletingLastPathComponent())
    }

    let shellLog = root.appending(path: "logs/shell.log")
    try Data(#"{"ts":"2026-11-18T14:00:00.000Z","level":"info","msg":"ok"}"#.utf8 + [0x0A]).write(
      to: shellLog)
    let memoryNote = root.appending(path: "memory/notes.md")
    try Data("secret".utf8).write(to: memoryNote)

    let builder = DiagnosticsBundleBuilder()
    let preview = try builder.preview(
      inputs: .init(
        shellLogFileURL: shellLog,
        serviceLogDirectoryURL: root.appending(path: "logs"),
        dataDirectoryURL: root,
        anchors: Self.testAnchors))
    let shellEntry = try #require(
      preview.files.first(where: { $0.path == "logs/shell.tail.jsonl" }))
    #expect(shellEntry.status == .included)

    #expect(throws: ScrubberAbortReason.scrubberException) {
      _ = try builder.preview(
        inputs: .init(
          dataDirectoryURL: root,
          rejectedSourceURLs: [memoryNote],
          anchors: Self.testAnchors))
    }
  }
}
