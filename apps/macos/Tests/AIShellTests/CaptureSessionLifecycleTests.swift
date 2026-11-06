import AppKit
import CoreGraphics
import Testing

@testable import AIShell

@MainActor
@Suite("Capture pixel lifetime", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct CaptureSessionLifecycleTests {
  @Test("Finishing releases frozen pixels even when a closed window remains retained")
  func closedWindowReleasesPixels() async throws {
    let fixture = try CaptureLifecycleFixture()
    defer { fixture.dispose() }
    #expect(fixture.overlay.value != nil)
    #expect(fixture.image.value != nil)
    fixture.session.cancel()
    try await CaptureLifecycleFixture.settle()
    #expect(fixture.session.isFinished)
    #expect(fixture.session.overlays.isEmpty)
    // AppKit can retain recently closed windows; that must not extend captured-pixel ownership.
    #expect(fixture.overlay.value == nil)
    #expect(fixture.image.value == nil)
  }

  @Test("Cancelling during a press drops the phase's overlay and frozen pixels")
  func cancelledPressReleasesPixels() async throws {
    let fixture = try CaptureLifecycleFixture(pressing: true)
    defer { fixture.dispose() }
    fixture.session.cancel()
    // Isolate session state from the independently tested retained-window ownership path.
    fixture.window.contentView = nil
    try await CaptureLifecycleFixture.settle()
    #expect(fixture.overlay.value == nil)
    #expect(fixture.image.value == nil)
  }

  @Test("Repeated sessions leave no pixel-owning overlays in retained closed windows")
  func repeatedSessionsReleasePixels() async throws {
    var fixtures: [CaptureLifecycleFixture] = []
    defer { for fixture in fixtures { fixture.dispose() } }
    let started = CFAbsoluteTimeGetCurrent()
    for _ in 0..<24 {
      let fixture = try CaptureLifecycleFixture()
      fixtures.append(fixture)
      fixture.session.cancel()
    }
    try await CaptureLifecycleFixture.settle()
    let overlays = fixtures.filter { $0.overlay.value != nil }.count
    let images = fixtures.filter { $0.image.value != nil }.count
    print(
      "capture-sessions=24 seconds=\(CFAbsoluteTimeGetCurrent() - started) retained-overlays=\(overlays) retained-images=\(images) retained-windows=\(fixtures.count)"
    )
    #expect(overlays == 0)
    #expect(images == 0)
  }
}
