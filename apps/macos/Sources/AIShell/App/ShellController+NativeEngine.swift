import AICore
import Foundation

/// The native computer engine `atd` with its application preparer, built for this shell. The
/// engine runs the driver helper this build embeds (``DriverLaunch/bundled(_:)``) and logs the
/// driver's stderr to `computer/atd-computer-driver.log` in the shell's data directory. The root
/// registers the engine (`computer.engines.register`) and composes the preparer with the browser
/// one; nothing is started until a request needs the engine.
extension ShellController {
  func makeNativeComputer() -> (engine: NativeEngine, application: ApplicationTargetPreparer) {
    let log = services.dataDirectory
      .appending(path: "computer", directoryHint: .isDirectory)
      .appending(path: "\(DriverLaunch.executableName).log", directoryHint: .notDirectory)
    let engine = NativeEngine(
      configuration: NativeEngine.Configuration(driver: DriverLaunch.bundled(), log: log))
    let application = ApplicationTargetPreparer(
      saveBinding: { [services] in try await services.client().saveComputerBinding($0) },
      systemPanels: systemPanels)
    return (engine, application)
  }
}
