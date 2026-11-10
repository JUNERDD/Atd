import AICore
import AppKit
import Observation
import SwiftUI

/// Key presses drawn into the recording when Show Keys is on (decision R5): a glass badge near
/// the bottom of the recorded region shows the latest press for a moment. Unlike every other
/// Atd window it is in the video: the recorder names this window among the ones its filter keeps
/// (``windowNumber``), which ScreenCaptureKit only finds while the window is on screen, so
/// ``prepare()`` orders it in, empty, before the recording reads its shareable content. It takes
/// no clicks.
final class RecordingKeyBadges {
  /// How long a badge stays after the last press.
  private static let lifetime: Duration = .milliseconds(900)

  private let region: CGRect
  private let model = RecordingKeyBadgeModel()
  private var window: NSPanel?
  private var fade: Task<Void, Never>?

  /// `region` is the recorded region, Quartz points.
  init(region: CGRect) {
    self.region = region
  }

  /// The window ScreenCaptureKit must keep, once ``prepare()`` showed it.
  var windowNumber: Int? { window?.windowNumber }

  /// Puts the empty window over the region.
  func prepare() {
    guard window == nil else { return }
    let window = RecordingOverlayWindow.make()
    window.setFrame(RecordingOverlayWindow.cocoaFrame(region), display: false)
    let host = NSHostingView(rootView: RecordingKeyBadgeView(model: model))
    host.frame = CGRect(origin: .zero, size: region.size)
    host.autoresizingMask = [.width, .height]
    window.contentView = host
    window.orderFrontRegardless()
    self.window = window
  }

  /// Shows `press` until the next one, or until it has stood for a moment.
  func show(_ press: RecordingKeyPress) {
    guard window != nil else { return }
    model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    model.label = RecordingEngineText.keyLabel(press.modifiers, press.key)
    model.serial += 1
    let serial = model.serial
    fade?.cancel()
    fade = Task { [weak self] in
      try? await Task.sleep(for: Self.lifetime)
      guard !Task.isCancelled, let self, self.model.serial == serial else { return }
      self.model.label = nil
    }
  }

  /// Clears the badge, as a pause does; the window stays for the next press.
  func clear() {
    fade?.cancel()
    model.label = nil
  }

  func hide() {
    clear()
    window?.orderOut(nil)
    window = nil
  }
}

@Observable
final class RecordingKeyBadgeModel {
  var label: String?
  /// Counts presses, so a fade scheduled for an earlier one leaves a later one alone.
  var serial = 0
  var reduceMotion = false
}

/// The badge itself: 15 pt semibold on glass, 6 × 12 pt padding, corner 10, centred near the
/// region's bottom edge.
private struct RecordingKeyBadgeView: View {
  let model: RecordingKeyBadgeModel

  var body: some View {
    VStack {
      Spacer(minLength: 0)
      if let label = model.label {
        Text(label)
          .font(.system(size: 15, weight: .semibold))
          .monospacedDigit()
          .lineLimit(1)
          .padding(.vertical, 6)
          .padding(.horizontal, 12)
          .glassSurface(in: RoundedRectangle(cornerRadius: 10, style: .continuous), animation: nil)
          .id(model.serial)
          .transition(model.reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.92)))
      }
    }
    .padding(.bottom, 24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .animation(.easeOut(duration: model.reduceMotion ? 0.1 : 0.16), value: model.serial)
    .animation(.easeOut(duration: 0.2), value: model.label == nil)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
