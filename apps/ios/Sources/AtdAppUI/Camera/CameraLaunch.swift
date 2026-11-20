import AtdCameraUI
import AtdModel
import Foundation

/// The camera's work while the app launches (`AtdAppLaunch`): it starts picking up the photos
/// the Lock Screen capture extension left (`CameraInbox`), and keeps the extension's App Context
/// (the camera modes and the mode to start in) in step with the library.
enum CameraLaunch {
  private static var observer: DarwinObserver?
  private static var watching: Task<Void, Never>?
  private static var published: CameraContext?

  static func prepare() {
    CameraInbox.shared.start()
    guard let group = AppGroup.current(), let store = SharedStore.appGroup(group) else { return }
    publish(store.load(CommandLibrary.self).document)
    // The library changes in the app, the keyboard and the share sheet alike.
    let observer = DarwinObserver(name: group.changeNotificationName)
    self.observer = observer
    watching = Task {
      for await _ in observer.changes {
        publish(store.load(CommandLibrary.self).document)
      }
    }
    #if DEBUG
      CameraDebug.prepare()
    #endif
  }

  /// Tells the capture extension the modes `library` gives, starting in the one used last.
  static func publish(_ library: CommandLibrary) {
    let modes = CameraMode.modes(in: library)
    let start = CameraMode.start(in: modes, asked: nil, last: CameraMemory.lastModeID)
    let context = CameraContext(modes: modes, startModeID: start?.id).fitted()
    guard context != published else { return }
    published = context
    Task { try? await CaptureIntent.updateAppContext(context) }
  }
}
