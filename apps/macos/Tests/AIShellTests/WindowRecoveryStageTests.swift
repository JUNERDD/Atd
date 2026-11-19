import AICore
import AIRelay
import AppKit
import Foundation
import Testing
import WebKit

@testable import AIShell

@MainActor
@Suite("Window loading & native glass recovery stage", .serialized)
struct WindowRecoveryStageTests {
  @MainActor
  private struct StageHarness {
    let tempDir: URL
    let services: ShellServices
    let bridge: ShellBridge
    let host: WebViewHost
    let window: NSWindow
    let stage: WindowLoadingStage

    func tearDown() {
      stage.stop()
      host.close()
      window.close()
      try? FileManager.default.removeItem(at: tempDir)
    }
  }

  private static func makeHarness(
    fallbackDuration: Duration = .milliseconds(60)
  ) throws -> StageHarness {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-recovery-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    let dataDir = tempDir.appending(path: "AgentServiceDev", directoryHint: .isDirectory)
    let services = ShellServices.development(
      environment: ["AI_AGENT_DATA_DIR": dataDir.path(percentEncoded: false)],
      home: tempDir)
    let bridge = ShellBridge()
    let host = WebViewHost(role: .panel, fragment: nil, services: services, bridge: bridge)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 480),
      styleMask: [.titled, .closable, .resizable],
      backing: .buffered,
      defer: true)
    window.isReleasedWhenClosed = false
    let stage = WindowLoadingStage(
      host: host,
      window: window,
      titleKey: .appName,
      fallbackDuration: fallbackDuration)
    window.contentView = GlassBackground.make(content: stage.view)
    window.contentView?.frame = NSRect(x: 0, y: 0, width: 640, height: 480)
    window.contentView?.layoutSubtreeIfNeeded()
    return StageHarness(
      tempDir: tempDir, services: services, bridge: bridge, host: host, window: window, stage: stage
    )
  }

  @Test(
    "5s fallback fully removes WindowLoadingView before mounting single-fill WindowRecoveryView")
  func fallbackUnmountsLoadingViewWithoutDoubleGlassStacking() async throws {
    let harness = try Self.makeHarness(fallbackDuration: .milliseconds(50))
    defer { harness.tearDown() }

    harness.stage.setWindowVisible(true)
    let initialLoading = try #require(harness.stage.loadingView)
    #expect(initialLoading.superview === harness.stage.view)
    #expect(harness.stage.recoveryView == nil)

    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while harness.stage.recoveryView == nil, ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(10))
    }

    let recovery = try #require(harness.stage.recoveryView)
    #expect(recovery.reason == .timeout)
    #expect(harness.stage.loadingView == nil)
    #expect(initialLoading.superview == nil)
    #expect(harness.host.container.alphaValue == 0)

    // Verify zero double-stacked glass layers inside `stage.view`: only the hidden web container
    // and the single `WindowRecoveryView` exist beneath the window's glass container.
    #expect(harness.stage.view.subviews.count == 2)
    #expect(harness.stage.view.subviews == [harness.host.container, recovery])
    #expect(harness.stage.view.subviews.contains(where: { $0 is WindowLoadingView }) == false)
    #expect(harness.stage.view.subviews.contains(where: { $0 is NSVisualEffectView }) == false)
    #expect(recovery.layer?.backgroundColor != nil)
  }

  @Test("4th WebContent crash within 60s trips circuit breaker and mounts .crashed immediately")
  func fourthWebContentCrashImmediatelyMountsRecovery() throws {
    let harness = try Self.makeHarness(fallbackDuration: .seconds(30))
    defer { harness.tearDown() }

    harness.stage.setWindowVisible(true)
    let initialLoading = try #require(harness.stage.loadingView)

    harness.host.rebuild()
    harness.host.rebuild()
    harness.host.rebuild()
    #expect(harness.stage.recoveryView == nil)
    #expect(harness.stage.loadingView != nil)

    // 4th crash within 60s trips `onCrashLoopExhausted` synchronously without waiting 30s.
    harness.host.rebuild()

    let recovery = try #require(harness.stage.recoveryView)
    #expect(recovery.reason == .crashed)
    #expect(harness.stage.loadingView == nil)
    #expect(initialLoading.superview == nil)

    let snap = harness.services.decisionRings.relaySupervisor.snapshot()
    #expect(snap.entries.last?.detail.stringValue == "webcontent_crash_exhausted:panel")
    #expect(snap.entries.last?.isAnomaly == true)
  }

  @Test("Late handleDragRegionsReady unmounts WindowRecoveryView and reveals the live page")
  func lateDragRegionsReadyRevealsPageFromRecovery() async throws {
    let harness = try Self.makeHarness(fallbackDuration: .milliseconds(40))
    defer { harness.tearDown() }

    harness.stage.setWindowVisible(true)
    let waitRecovery = ContinuousClock.now.advanced(by: .seconds(5))
    while harness.stage.recoveryView == nil, ContinuousClock.now < waitRecovery {
      try await Task.sleep(for: .milliseconds(10))
    }
    let recovery = try #require(harness.stage.recoveryView)
    harness.stage.animationFrameHook = { _, complete in
      DispatchQueue.main.async { complete(true) }
    }

    harness.stage.handleDragRegionsReady()

    let waitReveal = ContinuousClock.now.advanced(by: .seconds(5))
    while harness.stage.recoveryView != nil, ContinuousClock.now < waitReveal {
      try await Task.sleep(for: .milliseconds(10))
    }

    #expect(harness.stage.recoveryView == nil)
    #expect(harness.stage.loadingView == nil)
    #expect(recovery.superview == nil)
    #expect(harness.host.container.alphaValue == 1)
  }

  @Test(
    "WindowRecoveryView enforces PointerRole cursors, window drag, bilingual layout, and scrubbing")
  func recoveryViewPolishLayoutAndScrubbing() {
    defer { ShellStrings.shared.apply(appLanguage: "en") }

    let fixtureHome = "/" + "Users" + "/fixture_acct/Library/Token"
    let fixtureBearer = "Authorization: Bearer " + String(repeating: "z", count: 24)
    let secretFailure = "Failed reading \(fixtureHome) with \(fixtureBearer)"
    let card = WindowRecoveryView(
      frame: NSRect(x: 0, y: 0, width: 640, height: 420),
      reason: .timeout,
      serviceContextProvider: {
        WindowRecoveryView.ServiceContext(
          isDevelopment: false,
          unavailable: .failed(secretFailure),
          lastFailureSummary: secretFailure)
      })

    #expect(card.mouseDownCanMoveWindow == true)
    for button in card.actionButtons {
      #expect(button.mouseDownCanMoveWindow == false)
      #expect(button.resolvedCursor == NSCursor.pointingHand)
      button.isEnabled = false
      #expect(button.resolvedCursor == NSCursor.arrow)
      button.isEnabled = true
    }

    // Scrubbing invariant: raw personal home paths and bearer secrets never render on the card.
    #expect(!card.renderedBodyText.contains("fixture_acct"))
    #expect(!card.renderedBodyText.contains(String(repeating: "z", count: 24)))

    // Wide layout in English and Simplified Chinese fits horizontally without clipping labels.
    for lang in ["en", "zh-CN"] {
      ShellStrings.shared.apply(appLanguage: lang)
      card.frame = NSRect(x: 0, y: 0, width: 1_120, height: 420)
      card.layout()
      #expect(card.isStackedVertically == false)
      for button in card.actionButtons {
        #expect(button.frame.width >= button.naturalLabelWidth)
      }
    }

    // Narrow frame stacks buttons vertically at full available width without clipping.
    card.frame = NSRect(x: 0, y: 0, width: 280, height: 420)
    card.layout()
    #expect(card.isStackedVertically == true)
    #expect(card.reloadButton.frame.minY > card.restartButton.frame.minY)

    card.stop()
  }
}
