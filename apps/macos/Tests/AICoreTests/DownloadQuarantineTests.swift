import Foundation
import Testing

@testable import AICore

@Suite("Download quarantine")
struct DownloadQuarantineTests {
  @Test("The properties name the app and mark a non-web download")
  func properties() {
    #expect(
      DownloadQuarantine(agentName: "AI", agentBundleIdentifier: "com.junerdd.ai").properties == [
        "LSQuarantineAgentName": "AI",
        "LSQuarantineAgentBundleIdentifier": "com.junerdd.ai",
        "LSQuarantineType": "LSQuarantineTypeOtherDownload",
      ])
    #expect(
      DownloadQuarantine(agentName: "AI", agentBundleIdentifier: nil).properties == [
        "LSQuarantineAgentName": "AI", "LSQuarantineType": "LSQuarantineTypeOtherDownload",
      ])
  }

  /// A real file: the attribute Gatekeeper reads is on disk after the write.
  @Test("A written file carries com.apple.quarantine with the agent name")
  func writesAttribute() throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "quarantine-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appending(path: "run.command")
    try DownloadQuarantine(agentName: "AI Test", agentBundleIdentifier: nil)
      .write(Data("echo hi\n".utf8), to: file)
    #expect(try Data(contentsOf: file) == Data("echo hi\n".utf8))
    // `flags;timestamp;agent;event`. The agent field names the calling app's bundle, which a
    // test runner does not have; Launch Services keeps the given name with the event.
    let value = try #require(Self.attribute("com.apple.quarantine", of: file))
    #expect(value.split(separator: ";", omittingEmptySubsequences: false).count == 4)
    let stored = try #require(
      try file.resourceValues(forKeys: [.quarantinePropertiesKey]).quarantineProperties)
    #expect(stored["LSQuarantineAgentName"] as? String == "AI Test")
    #expect(stored["LSQuarantineType"] as? String == "LSQuarantineTypeOtherDownload")
  }

  static func attribute(_ name: String, of url: URL) -> String? {
    let path = url.path(percentEncoded: false)
    let size = getxattr(path, name, nil, 0, 0, 0)
    guard size > 0 else { return nil }
    var buffer = [UInt8](repeating: 0, count: size)
    guard getxattr(path, name, &buffer, size, 0, 0) == size else { return nil }
    return String(decoding: buffer, as: UTF8.self)
  }
}
