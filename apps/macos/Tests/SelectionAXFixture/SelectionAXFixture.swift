import AICore
import AIShell
import AppKit

/// A test-only application that exercises the production probe against its own real AX tree.
/// Self-inspection needs no Accessibility grant and never reads another application's data.
@main
struct SelectionAXFixture {
  @MainActor
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    Task {
      do {
        let args = CommandLine.arguments
        guard args.count == 3, let depth = Int(args[2]), (0...20).contains(depth),
          ["AXTable", "AXList", "AXOutline", "AXGrid"].contains(args[1])
        else { throw FixtureError.arguments }
        let result = try await run(role: NSAccessibility.Role(rawValue: args[1]), depth: depth)
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
        exit(0)
      } catch {
        FileHandle.standardError.write(Data("AX fixture failed: \(error)\n".utf8))
        exit(1)
      }
    }
    app.run()
  }

  @MainActor
  private static func run(role: NSAccessibility.Role, depth: Int) async throws -> [String: String] {
    let window = SelectionAXWindow(role: role, depth: depth)
    defer { window.close() }
    try await window.ready()
    let pid = getpid()
    let cell = window.cellPoint
    let blank = window.blankPoint
    return await Task.detached {
      let presence = SelectionPresence(pid: pid)
      return [
        "cell": kind(presence.probe(gestureAt: cell)),
        "blank": kind(presence.probe(gestureAt: blank)),
        "focus": kind(presence.probe()),
      ]
    }.value
  }

  private static func kind(_ probe: SelectionProbe) -> String {
    switch probe {
    case .cells: "cells"
    case .none: "none"
    case .secureField: "secureField"
    case .selected: "text"
    case .unmeasured: "unmeasured"
    }
  }

  private enum FixtureError: Error { case arguments }
}
