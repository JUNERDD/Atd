import AppIntents
import AtdCameraUI
import LockedCameraCapture
import SwiftUI

/// The Lock Screen capture extension (LockedCameraCapture), opened by `CaptureIntent` while the
/// iPhone is locked. It can only take photos: it has no network and no App Group, it keeps them
/// in the session's content directory, and the app picks them up after the person unlocks
/// (`LockedCameraCaptureManager`, the `.lockedCapture` route).
@main
struct AtdCaptureExtension: LockedCameraCaptureExtension {
  var body: some LockedCameraCaptureExtensionScene {
    LockedCameraCaptureUIScene { _ in
      Viewfinder()
    }
  }
}

/// The App Intents this extension declares: `CaptureIntent`.
struct AtdCapturePackage: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] {
    [AtdCameraUIPackage.self]
  }
}
