import AppIntents
import AtdCameraUI
import Foundation
import LockedCameraCapture
import SwiftUI

/// The Lock Screen capture extension (LockedCameraCapture), opened by `CaptureIntent` while the
/// iPhone is locked. It can only take photos: it has no network and no App Group. It leaves each
/// photo in the session's content directory and asks the system to open Atd, which reads it
/// after the person unlocks (`CameraInbox`, the `.lockedCapture` route).
@main
struct AtdCaptureExtension: LockedCameraCaptureExtension {
  var body: some LockedCameraCaptureExtensionScene {
    LockedCameraCaptureUIScene { session in
      LockedCaptureScreen(folder: session.sessionContentURL) {
        let activity = NSUserActivity(activityType: NSUserActivityTypeLockedCameraCapture)
        try await session.openApplication(for: activity)
      }
    }
  }
}

/// The App Intents this extension declares: `CaptureIntent`.
struct AtdCapturePackage: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] {
    [AtdCameraUIPackage.self]
  }
}
