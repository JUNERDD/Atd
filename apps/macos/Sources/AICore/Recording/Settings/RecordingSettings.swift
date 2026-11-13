import Foundation

/// The seconds the screen counts down after Start before the recording begins.
public enum RecordingCountdown: Int, CaseIterable, Sendable {
  case none = 0
  case three = 3
  case five = 5
  case ten = 10

  public var seconds: Int { rawValue }
}

/// How sharp the recorded video is. The two fixed sizes cap the video's width in pixels; a
/// region narrower than the cap keeps its own pixels and is never scaled up.
public enum RecordingQuality: String, CaseIterable, Sendable {
  case hd720 = "720p"
  case hd1080 = "1080p"
  case original

  /// The widest the video gets, in pixels; nil records the region's own pixels.
  public var maxPixelWidth: Int? {
    switch self {
    case .hd720: 1280
    case .hd1080: 1920
    case .original: nil
    }
  }

  /// A typical file size at 30 fps, in megabytes per minute, for the Options menu's estimate.
  public var megabytesPerMinute: Double {
    switch self {
    case .hd720: 25
    case .hd1080: 50
    case .original: 110
    }
  }
}

public enum RecordingFrameRate: Int, CaseIterable, Sendable {
  case thirty = 30
  case sixty = 60

  public var framesPerSecond: Int { rawValue }

  /// How much larger a minute of video gets than at 30 fps.
  public var sizeFactor: Double { self == .sixty ? 1.6 : 1 }
}

/// What happens once a recording is processed.
public enum RecordingAfterAction: String, CaseIterable, Sendable {
  /// The Island shows the result card (player, steps, trim, ask).
  case card
  /// The movie is saved via ``SaveLocationFolders/current`` (or a save panel) and nothing else shows.
  case save
  /// The recording is attached to the panel's conversation.
  case attach
}

/// An audio input the recording can take its microphone track from.
public struct RecordingMicrophone: Equatable, Sendable {
  /// The device's unique ID (`AVCaptureDevice.uniqueID`), stable across launches.
  public let id: String
  /// The name the system gives it, as the Sound menu lists it.
  public let name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

/// A recording's settings, chosen on the record bar (architecture R2) and remembered between
/// recordings (``RecordingSettingsMemory``). The microphone is a device ID rather than a device:
/// the chosen one may be unplugged meanwhile, and records again once it is back.
public struct RecordingSettings: Equatable, Sendable {
  /// The microphone recorded: a device's unique ID, nil for none.
  public var microphone: String?
  /// The microphone last chosen, which the Island's microphone switch turns on; nil until one is
  /// chosen, when the switch takes the system's default input.
  public var lastMicrophone: String?
  public var systemAudio: Bool
  public var showPointer: Bool
  public var showClicks: Bool
  public var showKeys: Bool
  public var countdown: RecordingCountdown
  public var quality: RecordingQuality
  public var frameRate: RecordingFrameRate
  public var after: RecordingAfterAction
  /// Where movies are saved, and recently chosen folders.
  public var folders: SaveLocationFolders

  /// No microphone or system audio; pointer, clicks and keys shown; no countdown; 1080p at
  /// 30 fps; the result card; Ask each time.
  public static let defaults = Self(
    microphone: nil, lastMicrophone: nil, systemAudio: false, showPointer: true,
    showClicks: true, showKeys: true, countdown: .none, quality: .hd1080, frameRate: .thirty,
    after: .card, folders: SaveLocationFolders())

  public init(
    microphone: String?, lastMicrophone: String?, systemAudio: Bool, showPointer: Bool,
    showClicks: Bool, showKeys: Bool, countdown: RecordingCountdown, quality: RecordingQuality,
    frameRate: RecordingFrameRate, after: RecordingAfterAction, folders: SaveLocationFolders
  ) {
    self.microphone = microphone
    self.lastMicrophone = lastMicrophone
    self.systemAudio = systemAudio
    self.showPointer = showPointer
    self.showClicks = showClicks
    self.showKeys = showKeys
    self.countdown = countdown
    self.quality = quality
    self.frameRate = frameRate
    self.after = after
    self.folders = folders
  }

  /// Records `id`'s microphone from now on (nil: none); a device becomes the last microphone.
  public mutating func chooseMicrophone(_ id: String?) {
    microphone = id
    if let id { lastMicrophone = id }
  }

  /// The chosen microphone when it is connected (`devices`); nil records none.
  public func microphone(among devices: [RecordingMicrophone]) -> RecordingMicrophone? {
    microphone.flatMap { id in devices.first { $0.id == id } }
  }

  /// The microphone the Island's switch turns on: the last one chosen while it is connected,
  /// else the system's default input (`defaultID`), else the first connected one.
  public func switchMicrophone(among devices: [RecordingMicrophone], defaultID: String?)
    -> RecordingMicrophone?
  {
    for id in [lastMicrophone, defaultID].compactMap(\.self) {
      if let device = devices.first(where: { $0.id == id }) { return device }
    }
    return devices.first
  }

  /// About how many megabytes a minute of video takes at these settings.
  public var estimatedMegabytesPerMinute: Int {
    Self.estimatedMegabytesPerMinute(quality: quality, frameRate: frameRate)
  }

  public static func estimatedMegabytesPerMinute(
    quality: RecordingQuality, frameRate: RecordingFrameRate
  ) -> Int {
    Int((quality.megabytesPerMinute * frameRate.sizeFactor).rounded())
  }

  /// Every estimate the menu can show, so its row keeps the width of the widest.
  public static var allEstimates: [Int] {
    RecordingQuality.allCases.flatMap { quality in
      RecordingFrameRate.allCases.map {
        estimatedMegabytesPerMinute(quality: quality, frameRate: $0)
      }
    }
  }
}
