import AICore
import Foundation

/// What the engine publishes: its refs' capabilities and the profile `computer.hello` carries.
extension PlaywrightBrowserEngine {
  /// What each target supports: every step in the background, elements named by ref or
  /// semantically (never by image point), verified only where flows were qualified.
  static var targetCapabilities: [TargetCapabilityWire] {
    BrowserWorkerCapabilities.target(verified: verifiedActions)
  }

  /// What `computer.hello` publishes: qualified while Chrome and the worker are installed, for
  /// the background. A browser that does not run is started by the access operation, in the
  /// background (``ManagedChromes/openFirstPage(for:running:)``), not by the engine.
  static func makeProfile(chromeVersion: String?, workerReady: Bool) -> CapabilityProfileWire {
    let evidence: String =
      if let chromeVersion, workerReady {
        "playwright-core \(BrowserWorkerCapabilities.playwrightVersion) over CDP on a managed Google Chrome "
          + "\(chromeVersion) profile, in the background: "
          + "navigate, fill, press, scroll and wait at parity with the earlier engine; clear, "
          + "key, select and upload unverified. Clicks are trusted input. Popups of the page on "
          + "its sites are surfaces; downloads are saved for the run only. A website's page opens "
          + "in a background tab, or a parked background window when the browser has none."
      } else if chromeVersion == nil {
        "Google Chrome is not installed."
      } else {
        "The browser worker is not installed."
      }
    return BrowserWorkerCapabilities.profile(
      engine: .playwright,
      qualification: chromeVersion != nil && workerReady ? .qualified : .unqualified,
      evidence: evidence)
  }
}
