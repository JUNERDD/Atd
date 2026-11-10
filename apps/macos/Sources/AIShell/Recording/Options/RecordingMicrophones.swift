import AICore
import AVFoundation

/// The Mac's audio inputs as the Sound menu lists them and the recording finds them again by ID.
/// Listing them needs no microphone permission; only recording from one asks for it.
enum RecordingMicrophones {
  /// The connected inputs (built-in, USB, Bluetooth, Continuity…) in the system's order, each
  /// once.
  static func available() -> [RecordingMicrophone] {
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
    var seen = Set<String>()
    return discovery.devices.compactMap { device in
      guard seen.insert(device.uniqueID).inserted else { return nil }
      return RecordingMicrophone(id: device.uniqueID, name: device.localizedName)
    }
  }

  /// The system's default input (Sound settings), nil without any.
  static func defaultID() -> String? {
    AVCaptureDevice.default(for: .audio)?.uniqueID
  }
}
