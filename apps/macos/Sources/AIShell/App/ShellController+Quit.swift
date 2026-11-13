import AIRelay
import AppKit

extension ShellController {
  /// Capture overlays leave before a quit confirmation. A committed quit also discards the
  /// recording, hides every window and shuts down the computer host before the service.
  static func makeQuitGuard(
    services: ShellServices, computer: ComputerCoordinator, control: ControlStreamClient,
    screenshots: ScreenshotTaker, cancelRecording: @escaping () -> Void
  ) -> QuitGuard {
    QuitGuard(
      activeRuns: {
        screenshots.cancel()
        return await services.link.activeRunsForQuitGuard()
      },
      stopService: {
        await computer.shutdown()
        control.stop()
        await services.stopForQuit()
      },
      hideWindows: {
        screenshots.cancel()
        cancelRecording()
        for window in NSApp.windows { window.orderOut(nil) }
      })
  }
}
