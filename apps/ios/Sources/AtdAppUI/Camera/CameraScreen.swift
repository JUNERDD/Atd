import AtdCameraUI
import AtdModel
import SwiftUI

/// How the camera opens: live, in a command's mode when the route names one, or with the photos
/// the Lock Screen capture extension took.
enum CameraEntry: Hashable, Identifiable {
  case live(commandID: String?)
  case lockedCapture

  var id: Self { self }

  /// The entry a camera route names; nil for any other route.
  init?(_ route: AtdRoute) {
    switch route {
    case .camera(let commandID): self = .live(commandID: commandID)
    case .lockedCapture: self = .lockedCapture
    default: return nil
    }
  }
}

/// 拍了就办, full screen over the tabs. The root presents it for a camera route; while it shows,
/// later camera routes come here (the screen takes them from `RouteCenter`) instead of opening a
/// second camera.
///
/// Stub (F0a): the viewfinder placeholder and ✕. WS-C replaces it (prototype `camera.js`).
struct CameraScreen: View {
  @State private var entry: CameraEntry
  @Environment(\.dismiss) private var dismiss
  private let routes = RouteCenter.shared

  init(entry: CameraEntry) {
    _entry = State(initialValue: entry)
  }

  var body: some View {
    Viewfinder()
      .ignoresSafeArea()
      .overlay(alignment: .topLeading) {
        CloseButton { dismiss() }
          .padding(.horizontal, 10)
      }
      .onChange(of: routes.pending) {
        if let entry = routes.take(CameraEntry.init) { self.entry = entry }
      }
  }
}
