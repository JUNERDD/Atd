import AICore
import Foundation
@_weakLinked import ScreenCaptureKit

/// Objective-C picker callbacks do not declare their executor. Framework objects are only
/// retained during the hop, then inspected and used exclusively on the main actor.
nonisolated enum ScreenSharingPickerEvent: @unchecked Sendable {
  case selected(SCContentFilter, SCStream?)
  case cancelled(hasStream: Bool)
  case failed
}

/// A distinct observer captures its share's immutable token before a callback can be queued.
/// Removing an observer does not retract callbacks already queued by the system.
final class ScreenSharingPickerObserver: NSObject, SCContentSharingPickerObserver {
  let token: String
  let handler: @MainActor @Sendable (String, ScreenSharingPickerEvent) -> Void

  init(
    token: String,
    handler: @escaping @MainActor @Sendable (String, ScreenSharingPickerEvent) -> Void
  ) {
    self.token = token
    self.handler = handler
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?
  ) {
    deliver(.selected(filter, stream))
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker, didCancelFor stream: SCStream?
  ) {
    deliver(.cancelled(hasStream: stream != nil))
  }

  nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
    deliver(.failed)
  }

  nonisolated private func deliver(_ event: ScreenSharingPickerEvent) {
    Task { @MainActor [handler, token] in handler(token, event) }
  }
}

extension ScreenSharingSession {
  func presentPicker() {
    let picker = SCContentSharingPicker.shared
    if let observer { picker.remove(observer) }
    let token = UUID().uuidString.lowercased()
    pickerToken = token
    let observer = ScreenSharingPickerObserver(token: token) { [weak self] token, event in
      self?.pickerEvent(event, token: token)
    }
    self.observer = observer
    picker.add(observer)
    var configuration = SCContentSharingPickerConfiguration()
    configuration.allowedPickerModes = [.singleDisplay, .singleWindow]
    configuration.allowsChangingSelectedContent = true
    picker.defaultConfiguration = configuration
    picker.maximumStreamCount = 4
    picker.isActive = true
    picker.present()
  }

  private func pickerEvent(_ event: ScreenSharingPickerEvent, token: String) {
    guard pickerToken == token else { return }
    switch event {
    case .selected(let filter, let stream):
      let current =
        stream.flatMap { stream in shares.first { $0.stream?.stream === stream } }
        ?? (stream == nil ? shares.first(where: \.selecting) : nil)
      guard let current else { return }
      selected(filter, current: current)
    case .cancelled(let hasStream):
      if !hasStream, let pending = shares.first(where: \.selecting) {
        end(pending, reason: .cancelled)
      }
    case .failed:
      if let pending = shares.first(where: \.selecting) { end(pending, reason: .captureFailed) }
    }
  }

  private func selected(_ filter: SCContentFilter, current: Share) {
    let previous = current.stream
    let opening = current.opening
    onSourceRemoved?(current.id)
    previous?.invalidate()
    opening?.cancel()
    retire(previous, opening: opening)
    current.id = UUID().uuidString.lowercased()
    current.selecting = false
    let id = current.id
    let source = SharedScreenStream()
    current.stream = source
    source.onEnd = { [weak self, weak current] reason in
      guard let self, let current, self.contains(current), current.id == id else { return }
      self.end(current, reason: reason)
    }
    onSourceAdded?(current)
    let cleanup = self.cleanup
    current.opening = Task { [weak self, weak current] in
      await cleanup?.value
      await self?.beforeSourceStart?()
      guard let self, let current, self.contains(current), current.id == id, !Task.isCancelled
      else {
        await source.stop()
        return
      }
      do {
        try await source.start(filter: filter)
        guard self.contains(current), current.id == id, !Task.isCancelled else {
          await source.stop()
          return
        }
        current.opening = nil
      } catch {
        await source.stop()
        if self.contains(current), current.id == id { self.end(current, reason: .captureFailed) }
      }
    }
  }
}
