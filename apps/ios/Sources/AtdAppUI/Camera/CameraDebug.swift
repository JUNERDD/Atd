#if DEBUG
  import AtdModel
  import Foundation

  /// Simulator checks only, never compiled into Release. `simctl openurl` stops at
  /// a system confirmation nothing can answer, so launch arguments stand in for it:
  /// `-AtdDebug camera <modeID> <photo path>` opens the camera in that mode and runs the photo
  /// as if it was picked from the library (the photo must be inside the app's container). The
  /// camera's links (`atd-dev://camera`, `…/camera?command=<id>`, `…/captured`) open through
  /// `EntryDebug`'s `-AtdDebug url <url>`, like any other link.
  enum CameraDebug {
    static func prepare() {
      let arguments = ProcessInfo.processInfo.arguments
      guard let flag = arguments.firstIndex(of: "-AtdDebug"), flag + 3 < arguments.count,
        arguments[flag + 1] == "camera",
        let photo = FileManager.default.contents(atPath: arguments[flag + 3])
      else { return }
      CameraInbox.shared.hand(photo)
      RouteCenter.shared.open(.camera(commandID: arguments[flag + 2]))
    }
  }
#endif
