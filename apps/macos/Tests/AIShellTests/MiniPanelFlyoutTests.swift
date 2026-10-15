import AICore
import AppKit
import SwiftUI
import Testing

@testable import AIShell

@MainActor
@Suite("Mini panel command updates", .enabled(if: !NSScreen.screens.isEmpty))
struct MiniPanelFlyoutTests {
  @Test("Removing commands keeps existing SwiftUI rows renderable")
  func removesCommands() async throws {
    let model = MiniPanelModel()
    let commands = (0..<5).map {
      MiniPanelSetCommandsParams.Command(id: "command-\($0)", name: "Command \($0)")
    }
    model.commands = commands
    model.setPresence(.rows, MiniPanelPresence(shown: true))
    let bounds = CGRect(x: 0, y: 0, width: 240, height: 240)
    let view = NSHostingView(
      rootView: MiniPanelFlyout(
        model: model, card: MiniPanelGlassRect(bounds, corner: 12, in: bounds),
        rest: bounds, animation: nil))
    view.frame = bounds
    let window = NSWindow(
      contentRect: bounds, styleMask: .borderless, backing: .buffered, defer: false)
    window.contentView = view
    defer { window.contentView = nil }

    // Keep the hosting tree alive across removal, reorder and empty-list updates. A departing
    // ForEach child must never read its old index from the model's new, shorter array.
    for next in [commands, Array(commands.dropLast()), Array(commands.reversed()), []] {
      model.commands = next
      try await Task.sleep(for: .milliseconds(100))
      view.layoutSubtreeIfNeeded()
      let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
      view.cacheDisplay(in: view.bounds, to: bitmap)
      #expect(bitmap.pixelsWide > 0)
      #expect(bitmap.pixelsHigh > 0)
    }
  }
}
