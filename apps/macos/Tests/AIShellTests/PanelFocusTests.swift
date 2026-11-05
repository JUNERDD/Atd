import AppKit
import Foundation
import Testing

/// This suite changes global keyboard focus and requires event-posting permission. It is opt-in
/// and must run alone; ordinary CI must not commandeer the desktop or prompt for TCC permission.
@MainActor
@Suite(
  "Panel focus through WindowServer", .serialized,
  .enabled(if: ProcessInfo.processInfo.environment["ATD_RUN_PANEL_FOCUS_TESTS"] == "1"))
struct PanelFocusTests {
  @Test(
    "The first click after another app transfers typing to both web input kinds",
    arguments: focusConfigurations)
  func switches(configuration: FocusConfiguration) async throws {
    let (mode, tuning, policy, scenario, pageGlass) = configuration
    let cycles = Int(ProcessInfo.processInfo.environment["ATD_PANEL_FOCUS_CYCLES"] ?? "8") ?? 8
    let result = try await probe(
      mode: mode, tuning: tuning, policy: policy, scenario: scenario, pageGlass: pageGlass,
      cycles: cycles)
    try #require(
      result.status != "blocked-event-permission",
      "Inconclusive: the fixture lacks CGEvent posting permission; no prompt was requested")
    #expect(result.samples.count == cycles * (scenario == "visible" ? 1 : 2))
    // Historical behavior is an observation control, not the required product behavior. Its
    // real mouse delivery remains required so consumed first clicks cannot be a harness miss.
    if mode == "legacy" || scenario == "release-policy" {
      for sample in result.samples where sample.phase != "summon" {
        #expect(sample.nativeMouseDowns == 1)
      }
      return
    }
    #expect(result.status == "completed")
    #expect(result.webContentTerminations == 0)
    #expect(result.bridgeDeliveryFailures == 0)
    for sample in result.samples {
      let summoned = sample.phase == "summon"
      if scenario == "clear" {
        #expect(sample.outerGlassStyle == (sample.cycle % 3 == 1 ? "clear" : "regular"))
      }
      if summoned { #expect(sample.peerFrontmost) } else { #expect(sample.appActive) }
      #expect(sample.windowKey, "\(mode)/\(tuning) cycle \(sample.cycle): panel is not key")
      #expect(sample.page.focused)
      #expect(sample.page.active == sample.field)
      #expect(sample.page.length == 1)
      #expect(sample.nativeMouseDowns == (summoned ? 0 : 1))
      #expect(sample.nativeKeyDowns == 1)
      #expect(sample.page.pointerDowns == (summoned ? 0 : 1))
      #expect(sample.page.keyDowns == 1)
      #expect(sample.page.bridgeEvents > sample.beforePage.bridgeEvents)
      #expect(sample.page.windowActive == "true")
      #expect(sample.page.hitIsTarget)
      if pageGlass != "off" {
        #expect(sample.page.supportsGlass)
        #expect(sample.page.visualEffect == "-apple-system-glass-material")
      }
      if pageGlass == "active" {
        #expect(sample.beforePage.windowActive == "false")
        #expect(sample.beforePage.visualEffect == "none")
      }
    }
  }

  private struct Result: Decodable {
    let status: String
    let samples: [Sample]
    let webContentTerminations: Int
    let bridgeDeliveryFailures: Int
  }

  private struct Sample: Decodable {
    let cycle: Int
    let field: String
    let phase: String
    let outerGlassStyle: String
    let peerFrontmost: Bool
    let appActive: Bool
    let windowKey: Bool
    let nativeMouseDowns: Int
    let nativeKeyDowns: Int
    let beforePage: Page
    let page: Page
  }

  private struct Page: Decodable {
    let focused: Bool
    let active: String
    let length: Int
    let pointerDowns: Int
    let keyDowns: Int
    let bridgeEvents: Int
    let windowActive: String
    let visualEffect: String
    let supportsGlass: Bool
    let hitIsTarget: Bool
  }

  private func probe(
    mode: String, tuning: String, policy: String, scenario: String, pageGlass: String, cycles: Int
  ) async throws -> Result {
    let executable = Bundle(for: PanelFocusBundle.self).bundleURL.deletingLastPathComponent()
      .appendingPathComponent("PanelFocusFixture")
    let process = Process()
    process.executableURL = executable
    process.arguments = [mode, tuning, policy, scenario, pageGlass, String(cycles)]
    // Files cannot fill a pipe and deadlock the child during a long repeated-cycle probe.
    let temporary = FileManager.default.temporaryDirectory
      .appendingPathComponent("PanelFocusOutput-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let outputURL = temporary.appendingPathComponent("result.json")
    let errorsURL = temporary.appendingPathComponent("stderr")
    FileManager.default.createFile(atPath: outputURL.path, contents: nil)
    FileManager.default.createFile(atPath: errorsURL.path, contents: nil)
    let output = try FileHandle(forWritingTo: outputURL)
    let errors = try FileHandle(forWritingTo: errorsURL)
    defer {
      try? output.close()
      try? errors.close()
    }
    process.standardOutput = output
    process.standardError = errors
    let timeout = Task {
      do {
        try await Task.sleep(for: .seconds(25 + cycles * (scenario == "visible" ? 3 : 8)))
      } catch { return }
      if process.isRunning { process.terminate() }
      try? await Task.sleep(for: .seconds(2))
      if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }
    defer {
      timeout.cancel()
      if process.isRunning { process.terminate() }
    }
    let status: Int32 = try await withCheckedThrowingContinuation { continuation in
      process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
      do { try process.run() } catch { continuation.resume(throwing: error) }
    }
    let data = try Data(contentsOf: outputURL)
    let diagnostics = try String(contentsOf: errorsURL, encoding: .utf8)
    if let path = ProcessInfo.processInfo.environment["ATD_PANEL_FOCUS_RESULT_DIR"] {
      let directory = URL(fileURLWithPath: path, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(
        to: directory.appendingPathComponent(
          "\(mode)-\(tuning)-\(policy)-\(scenario)-\(pageGlass).json"))
      try Data(diagnostics.utf8).write(
        to: directory.appendingPathComponent(
          "\(mode)-\(tuning)-\(policy)-\(scenario)-\(pageGlass).stderr"))
    }
    try #require(status == 0, "Panel focus fixture exited with \(status): \(diagnostics)")
    return try JSONDecoder().decode(Result.self, from: data)
  }
}

private final class PanelFocusBundle: NSObject {}

/// Current/fallback versus the complete historical first-click focus behavior, under both Dock
/// policies. Regular-window controls retain the ordinary activation baseline.
typealias FocusConfiguration = (String, String, String, String, String)
private let focusConfigurations: [FocusConfiguration] = {
  if ProcessInfo.processInfo.environment["ATD_PANEL_FOCUS_MATRIX"] == "release-policy" {
    return ["native", "fallback"].flatMap { mode in
      ["release-policy", "head-policy", "clear"].map { (mode, "tuned", "accessory", $0, "active") }
    }
  }
  if ProcessInfo.processInfo.environment["ATD_PANEL_FOCUS_MATRIX"] == "glass" {
    return ["native", "fallback", "legacy"].flatMap { mode in
      ["system", "tuned"].flatMap { tuning in
        ["off", "static", "active"].map { (mode, tuning, "accessory", "summon", $0) }
      }
    }
  }
  return ["native", "fallback", "legacy"].flatMap { mode in
    ["system", "tuned"].flatMap { tuning in
      ["accessory", "regular"].flatMap { policy in
        let scenarios =
          mode == "legacy"
          ? ["visible", "summon"] : ["visible", "summon", "presence", "pinned"]
        return scenarios.map { (mode, tuning, policy, $0, "off") }
      }
    }
  } + [
    ("regular", "system", "accessory", "visible", "off"),
    ("regular", "tuned", "regular", "visible", "off"),
  ]
}()
