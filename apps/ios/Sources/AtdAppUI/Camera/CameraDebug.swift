#if DEBUG
  import AtdModel
  import Foundation

  /// Simulator checks only, never compiled into Release. `simctl openurl` stops at
  /// a system confirmation nothing can answer, so launch arguments stand in for it:
  /// - `-AtdDebug camera-link <url>` opens one of the camera's links (`atd-dev://camera`,
  ///   `…/camera?command=<id>`, `…/captured`) through `RouteCenter.open(_:)`, the real parser;
  /// - `-AtdDebug camera <modeID> <photo path>` opens the camera in that mode and runs the photo
  ///   as if it was picked from the library (the photo must be inside the app's container).
  enum CameraDebug {
    static func prepare() {
      let arguments = ProcessInfo.processInfo.arguments
      guard let index = arguments.firstIndex(of: "-AtdDebug") else { return }
      let rest = arguments[(index + 1)...].map { $0 }
      switch rest.first {
      case "camera-link" where rest.count > 1:
        if let url = URL(string: rest[1]) { RouteCenter.shared.open(url) }
      case "camera" where rest.count > 2:
        guard let photo = FileManager.default.contents(atPath: rest[2]) else { return }
        CameraInbox.shared.hand(photo)
        RouteCenter.shared.open(.camera(commandID: rest[1]))
      default:
        break
      }
    }
  }
#endif
