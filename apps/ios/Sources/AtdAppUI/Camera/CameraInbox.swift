import AtdCameraUI
import AtdModel
import Foundation
import LockedCameraCapture
import Observation

/// Photos waiting for the camera. The Lock Screen capture extension's: the system keeps each in
/// a session directory (`LockedCameraCaptureManager`) until the app discards it; a complete one
/// opens the camera (`.lockedCapture`), which runs the newest; once the person closes or
/// retakes it, it is discarded and the next one, if any, shows. And one photo handed over from
/// elsewhere (a Visual Intelligence frame, a DEBUG fixture), which the camera runs the next time
/// it opens in a mode.
@Observable
final class CameraInbox {
  static let shared = CameraInbox()

  /// Session folders holding a complete capture, newest last.
  private(set) var folders: [URL] = []
  @ObservationIgnored private var handed: Data?
  @ObservationIgnored private var watching: Task<Void, Never>?
  @ObservationIgnored private var delaying = false

  /// Leaves `photo` for the camera; open it with a `.camera` route.
  func hand(_ photo: Data) {
    handed = photo
  }

  /// The photo handed over, once.
  func takeHanded() -> Data? {
    defer { handed = nil }
    return handed
  }

  /// Starts following the session folders; the newest can appear shortly after launch.
  func start() {
    guard watching == nil else { return }
    let manager = LockedCameraCaptureManager.shared
    if manager.sessionContentURLs.contains(where: { LockedCaptureFolder.read($0) != nil }) {
      // Opened from the Lock Screen: hold the first frame until the photo is on screen.
      manager.beginDelayingAppearance()
      delaying = true
      Task {
        try? await Task.sleep(for: .seconds(1))
        self.endDelaying()
      }
    }
    watching = Task {
      for await update in manager.sessionContentUpdates {
        switch update {
        case .initial(let urls): folders = urls.filter { LockedCaptureFolder.read($0) != nil }
        case .added(let url): if LockedCaptureFolder.read(url) != nil { folders.append(url) }
        case .removed(let url): folders.removeAll { $0 == url }
        @unknown default: break
        }
        if !folders.isEmpty { RouteCenter.shared.open(.lockedCapture) }
      }
    }
  }

  /// The newest complete capture, if any.
  func next() -> LockedCapture? {
    folders.compactMap(LockedCaptureFolder.read).max { $0.record.capturedAt < $1.record.capturedAt }
  }

  /// Lets the app appear once the capture is on screen (or after a second at most).
  func endDelaying() {
    guard delaying else { return }
    delaying = false
    LockedCameraCaptureManager.shared.endDelayingAppearance()
  }

  /// Discards a capture the person is done with; the system deletes its folder.
  func finish(_ folder: URL) {
    folders.removeAll { $0 == folder }
    Task { try? await LockedCameraCaptureManager.shared.invalidateSessionContent(at: folder) }
  }
}
