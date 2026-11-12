import AICore
import AVFoundation

/// The Mac's audio inputs as the Sound menu lists them and the recording finds them again by ID.
/// Listing them needs no microphone permission; only recording from one asks for it.
enum RecordingMicrophones {
  private static var cached: [RecordingMicrophone]?
  private static var observers: [NSObjectProtocol] = []

  /// The connected inputs (built-in, USB, Bluetooth, Continuity…) in the system's order, each
  /// once. Cached on the main actor until a capture device connects or disconnects, so opening
  /// menus and starting a take do not repeatedly query CoreAudio and Continuity HAL plugins.
  static func available() -> [RecordingMicrophone] {
    if let cached { return cached }
    observeChangesIfNeeded()
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
    var seen = Set<String>()
    let devices = discovery.devices.compactMap { device -> RecordingMicrophone? in
      guard seen.insert(device.uniqueID).inserted else { return nil }
      return RecordingMicrophone(id: device.uniqueID, name: device.localizedName)
    }
    cached = devices
    return devices
  }

  /// The system's default input (Sound settings), nil without any. Read directly so switching
  /// the default input in System Settings › Sound applies immediately without device hot-plug.
  static func defaultID() -> String? {
    AVCaptureDevice.default(for: .audio)?.uniqueID
  }

  private static func observeChangesIfNeeded() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    observers = [
      AVCaptureDevice.wasConnectedNotification,
      AVCaptureDevice.wasDisconnectedNotification,
    ].map { name in
      center.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { cached = nil }
      }
    }
  }
}
