import AppKit
import Foundation
import Testing

/// Each probe runs in a child with its own AppKit event loop. Starting NSApplication inside
/// the shared test runner interferes with concurrent SwiftUI/WebKit application lifecycles.
@MainActor
@Suite(
  "Selection presence through Accessibility", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct SelectionPresenceTests {
  @Test("A selected table is accepted even when hit testing lands twelve wrappers below its cell")
  func deepCell() async throws {
    let result = try await probe(role: "AXTable", depth: 12)
    #expect(result.cell == "cells")
  }

  @Test("Blank space does not inherit the focused table's retained selection")
  func blankSpace() async throws {
    let result = try await probe(role: "AXTable")
    #expect(result.cell == "cells")
    #expect(result.blank == "none")
    #expect(result.focus == "cells")
  }

  @Test(
    "Lists, outlines and thumbnail grids with selected cells are not spreadsheet selections",
    arguments: ["AXList", "AXOutline", "AXGrid"])
  func selectedItems(_ role: String) async throws {
    let result = try await probe(role: role)
    #expect(result.cell == "none")
    #expect(result.blank == "none")
    #expect(result.focus == "none")
  }

  private struct Snapshot: Decodable {
    let cell: String
    let blank: String
    let focus: String
  }

  private func probe(role: String, depth: Int = 0) async throws -> Snapshot {
    let executable = Bundle(for: FixtureBundle.self).bundleURL.deletingLastPathComponent()
      .appendingPathComponent("SelectionAXFixture")
    let process = Process()
    process.executableURL = executable
    process.arguments = [role, String(depth)]
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    let timeout = Task {
      do { try await Task.sleep(for: .seconds(20)) } catch { return }
      if process.isRunning { process.terminate() }
    }
    defer {
      timeout.cancel()
      if process.isRunning { process.terminate() }
    }
    let status: Int32 = try await withCheckedThrowingContinuation { continuation in
      process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
      do { try process.run() } catch { continuation.resume(throwing: error) }
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let diagnostics = String(
      decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    try #require(status == 0, "AX fixture exited with \(status): \(diagnostics)")
    return try JSONDecoder().decode(Snapshot.self, from: data)
  }
}

private final class FixtureBundle: NSObject {}
