import Darwin
import Foundation
import Testing

@testable import AICore

@Suite("ShellLogWriter MPSC queue, O_CLOEXEC, self-healing, and rotation")
struct ShellLogWriterTests {
  @Test("Opens shell.log with O_CLOEXEC and 0o600 permissions and isolates Dev vs Release paths")
  func cloexecAndPermissions() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "shell-log-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let devURL = ShellLogWriter.defaultLogURL(
      dataDirectory: tempDir.appending(path: "AgentService Dev"),
      homeDirectory: tempDir.appending(path: "Home"),
      isDevelopment: true)
    let relURL = ShellLogWriter.defaultLogURL(
      dataDirectory: tempDir.appending(path: "AgentService"),
      homeDirectory: tempDir.appending(path: "Home"),
      isDevelopment: false)
    #expect(devURL.path(percentEncoded: false).hasSuffix("/AgentService Dev/logs/shell.log"))
    #expect(relURL.path(percentEncoded: false).hasSuffix("/Home/Library/Logs/AI/shell.log"))

    let logURL = tempDir.appending(path: "logs/shell.log")
    let writer = ShellLogWriter(logFileURL: logURL, coalesceDelay: .seconds(10))
    writer.enqueue(level: .info, category: "lifecycle", message: "shell started")
    #expect(writer.flush(timeout: .seconds(2)))

    let fd = writer.activeFileDescriptorForTesting
    #expect(fd >= 0)
    let fdFlags = Darwin.fcntl(fd, F_GETFD)
    #expect(fdFlags >= 0)
    #expect((fdFlags & FD_CLOEXEC) != 0)

    var st = stat()
    #expect(lstat(logURL.path(percentEncoded: false), &st) == 0)
    #expect((st.st_mode & 0o777) == 0o600)
    writer.close()
  }

  @Test("Creating and immediately dropping 100 idle and unflushed writers never crashes")
  func rapidCreateAndDeinitSafety() {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "shell-log-deinit-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    for i in 0..<100 {
      let url = tempDir.appending(path: "idle-\(i).log")
      _ = ShellLogWriter(logFileURL: url, coalesceDelay: .seconds(5))
    }
    for i in 0..<100 {
      let url = tempDir.appending(path: "unflushed-\(i).log")
      let writer = ShellLogWriter(logFileURL: url, coalesceDelay: .seconds(30))
      writer.enqueue(level: .info, category: "test", message: "pending item \(i)")
    }
  }

  @Test("Overflow never blocks callers and records shell_log_ring_overflow on next flush")
  func nonBlockingOverflowMarker() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "shell-log-overflow-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let logURL = tempDir.appending(path: "shell.log")
    let writer = ShellLogWriter(
      logFileURL: logURL, capacity: 16, coalesceDelay: .seconds(60))
    // Keep below immediateFlushThreshold (64) while exceeding capacity (16).
    for i in 0..<40 {
      writer.enqueue(level: .info, category: "burst", message: "entry-\(i)")
    }
    #expect(writer.flush(timeout: .seconds(2)))
    writer.close()

    let text = try String(contentsOf: logURL, encoding: .utf8)
    let lines = text.split(separator: "\n")
    #expect(lines.count == 17)  // 16 retained slots + 1 overflow marker
    #expect(text.contains(#""msg":"shell_log_ring_overflow""#))
    #expect(text.contains(#""dropped":24"#))
  }

  @Test("Self-heals when active shell.log is unlinked or moved away, and rotates within maxFiles")
  func selfHealingAndRotation() throws {
    let tempDir = FileManager.default.temporaryDirectory.appending(
      path: "shell-log-rotate-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let logURL = tempDir.appending(path: "shell.log")
    let writer = ShellLogWriter(
      logFileURL: logURL, maxFileBytes: 1_500, maxFiles: 5, coalesceDelay: .seconds(30))

    writer.enqueue(level: .info, category: "init", message: "before unlink")
    #expect(writer.flush(timeout: .seconds(2)))
    #expect(Darwin.unlink(logURL.path(percentEncoded: false)) == 0)

    writer.enqueue(level: .warn, category: "heal", message: "after unlink")
    #expect(writer.flush(timeout: .seconds(2)))
    let healed = try String(contentsOf: logURL, encoding: .utf8)
    #expect(healed.contains("after unlink"))

    // Move-to-Trash simulation (`rename` keeps `st_nlink == 1` on old fd but removes path).
    let movedURL = tempDir.appending(path: "trashed.log")
    try FileManager.default.moveItem(at: logURL, to: movedURL)
    writer.enqueue(level: .warn, category: "heal", message: "after move")
    #expect(writer.flush(timeout: .seconds(2)))
    #expect(try String(contentsOf: logURL, encoding: .utf8).contains("after move"))
    try? FileManager.default.removeItem(at: movedURL)

    // Drive size-based rotation across 5 files (`shell.log` + `.1`..`.4`, never `.5`).
    let payload = String(repeating: "R", count: 220)
    for i in 0..<60 {
      writer.enqueue(level: .info, category: "rot", message: "\(i)-\(payload)")
      _ = writer.flush(timeout: .seconds(2))
    }
    writer.close()

    let fm = FileManager.default
    #expect(fm.fileExists(atPath: tempDir.appending(path: "shell.log").path(percentEncoded: false)))
    #expect(
      fm.fileExists(atPath: tempDir.appending(path: "shell.4.log").path(percentEncoded: false)))
    #expect(
      !fm.fileExists(atPath: tempDir.appending(path: "shell.5.log").path(percentEncoded: false)))
  }

  @Test(
    "B30: close(timeout:) obeys timeout when ioQueue write stalls and prevents post-close reopen")
  func closeHonorsTimeoutOnStalledQueueAndRejectsPostCloseFaults() throws {
    let fm = FileManager.default
    let tempDir = fm.temporaryDirectory.appending(
      path: "shell-log-b30-\(UUID().uuidString)", directoryHint: .isDirectory)
    try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: tempDir) }

    // 1) Post-close `.fault` writes must never reopen `shell.log`.
    let regularURL = tempDir.appending(path: "regular.log")
    let regularWriter = ShellLogWriter(logFileURL: regularURL, coalesceDelay: .seconds(30))
    regularWriter.enqueue(level: .info, category: "boot", message: "before close")
    regularWriter.close(timeout: .seconds(1))
    #expect(regularWriter.activeFileDescriptorForTesting == -1)

    regularWriter.enqueue(level: .fault, category: "late", message: "must not reopen")
    #expect(regularWriter.flush(timeout: .milliseconds(200)))
    #expect(regularWriter.activeFileDescriptorForTesting == -1)
    let written = try String(contentsOf: regularURL, encoding: .utf8)
    #expect(written.contains("before close"))
    #expect(!written.contains("must not reopen"))

    // 2) Stalled FIFO write: `close(timeout: .milliseconds(50))` must return promptly without
    //    blocking indefinitely inside `ioQueue.sync`.
    let fifoURL = tempDir.appending(path: "stalled.fifo")
    let fifoPath = fifoURL.path(percentEncoded: false)
    #expect(Darwin.mkfifo(fifoPath, mode_t(0o600)) == 0)

    let readFD = Darwin.open(fifoPath, O_RDONLY | O_NONBLOCK)
    #expect(readFD >= 0)
    defer { if readFD >= 0 { _ = Darwin.close(readFD) } }

    let fillFD = Darwin.open(fifoPath, O_WRONLY | O_NONBLOCK)
    #expect(fillFD >= 0)
    let fillChunk = [UInt8](repeating: 0x41, count: 4_096)
    fillChunk.withUnsafeBytes { ptr in
      while Darwin.write(fillFD, ptr.baseAddress!, ptr.count) > 0 {}
    }
    _ = Darwin.close(fillFD)

    let stalledWriter = ShellLogWriter(logFileURL: fifoURL, coalesceDelay: .seconds(30))
    // Enqueue a `.fault` batch large enough to block inside kernel pipe write.
    for idx in 0..<48 {
      stalledWriter.enqueue(
        level: idx == 47 ? .fault : .info,
        category: "stall",
        message: String(repeating: "S", count: 300))
    }
    Thread.sleep(forTimeInterval: 0.03)

    let closeStart = ContinuousClock.now
    stalledWriter.close(timeout: .milliseconds(50))
    let closeElapsed = closeStart.duration(to: ContinuousClock.now)
    #expect(closeElapsed < .milliseconds(400))

    // Drain the FIFO so the background write finishes and closes its descriptor cleanly.
    var drainBuf = [UInt8](repeating: 0, count: 16_384)
    for _ in 0..<32 {
      drainBuf.withUnsafeMutableBytes { ptr in
        while Darwin.read(readFD, ptr.baseAddress!, ptr.count) > 0 {}
      }
      if stalledWriter.activeFileDescriptorForTesting == -1 { break }
      Thread.sleep(forTimeInterval: 0.01)
    }
    #expect(stalledWriter.activeFileDescriptorForTesting == -1)
  }
}
