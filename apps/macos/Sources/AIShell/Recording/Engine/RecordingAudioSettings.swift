import AVFoundation

/// The encoding shared by the movie's system audio and the microphone's separate files.
nonisolated enum RecordingAudioSettings {
  /// AAC at 48 kHz: stereo for the system's output, mono for the microphone.
  static func aac(channels: Int) -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: channels,
      AVEncoderBitRateKey: channels == 1 ? 96_000 : 128_000,
    ]
  }
}
