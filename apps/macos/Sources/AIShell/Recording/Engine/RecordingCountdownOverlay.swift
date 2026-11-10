import AICore
import AppKit
import Observation
import SwiftUI

/// The countdown before a recording starts (decision R1): a 120 pt glass circle centred in the
/// region with the seconds left, 3, 5 or 10 down to 1. It shows before the capture starts and
/// takes no clicks; VoiceOver hears when recording begins.
final class RecordingCountdownOverlay {
  private static let side: CGFloat = 120

  private let model = RecordingCountdownModel()
  private var window: NSPanel?

  /// Counts from `seconds` down to 1, a second each, centred in `region` (Quartz points), then
  /// hides; false when the calling task was cancelled meanwhile (the user stopped or discarded
  /// during the countdown).
  func run(from seconds: Int, centeredIn region: CGRect) async -> Bool {
    guard seconds > 0 else { return !Task.isCancelled }
    defer { hide() }
    NSAccessibility.post(
      element: NSApplication.shared, notification: .announcementRequested,
      userInfo: [.announcement: RecordingEngineText.text(.countdown, count: seconds)])
    for number in stride(from: seconds, through: 1, by: -1) {
      show(number, centeredIn: region)
      do {
        try await Task.sleep(for: .seconds(1))
      } catch {
        return false
      }
    }
    return !Task.isCancelled
  }

  /// Shows `number` in the middle of `region` (Quartz points).
  func show(_ number: Int, centeredIn region: CGRect) {
    let window = window ?? makeWindow()
    self.window = window
    let frame = CGRect(
      x: region.midX - Self.side / 2, y: region.midY - Self.side / 2, width: Self.side,
      height: Self.side)
    window.setFrame(RecordingOverlayWindow.cocoaFrame(frame), display: false)
    model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    model.number = number
    window.orderFrontRegardless()
  }

  func hide() {
    window?.orderOut(nil)
    window = nil
    model.number = nil
  }

  private func makeWindow() -> NSPanel {
    let window = RecordingOverlayWindow.make(level: .statusBar)
    let host = NSHostingView(rootView: RecordingCountdownView(model: model))
    host.frame = CGRect(x: 0, y: 0, width: Self.side, height: Self.side)
    host.autoresizingMask = [.width, .height]
    window.contentView = host
    return window
  }
}

@Observable
final class RecordingCountdownModel {
  var number: Int?
  var reduceMotion = false
}

/// The circle and its number: 56 pt semibold, tabular, each new number settling from a little
/// larger and fainter (a plain fade under Reduce Motion).
private struct RecordingCountdownView: View {
  let model: RecordingCountdownModel

  var body: some View {
    ZStack {
      if let number = model.number {
        Text(String(number))
          .font(.system(size: 56, weight: .semibold))
          .monospacedDigit()
          .id(number)
          .transition(
            model.reduceMotion
              ? .opacity
              : .opacity.combined(with: .scale(scale: 1.12)).animation(.easeOut(duration: 0.26)))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .glassSurface(in: Circle(), animation: nil)
    .animation(.easeOut(duration: 0.26), value: model.number)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
