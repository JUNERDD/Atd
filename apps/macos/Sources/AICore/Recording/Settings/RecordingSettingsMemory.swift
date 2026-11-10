import Foundation

/// Keeps the recording settings across recordings in `UserDefaults`, under the shell's
/// `capture.recording.` keys (architecture R2), as ``AnnotationStyleMemory`` keeps the annotation
/// styles. The record bar saves every change at once, so a recording that starts reads the
/// current settings with ``load(from:folderExists:)``. Values are raw values, booleans and
/// paths; a missing or unknown value falls back to its default, and folders that no longer
/// exist drop out of the list as it loads.
public enum RecordingSettingsMemory {
  public static let prefix = "capture.recording."

  public static func load(
    from defaults: UserDefaults, folderExists: (String) -> Bool = isFolder
  ) -> RecordingSettings {
    var settings = RecordingSettings.defaults
    settings.microphone = defaults.string(forKey: Key.micDevice)
    settings.lastMicrophone = defaults.string(forKey: Key.lastMic)
    let toggles: [(String, WritableKeyPath<RecordingSettings, Bool>)] = [
      (Key.systemAudio, \.systemAudio), (Key.showPointer, \.showPointer),
      (Key.showClicks, \.showClicks), (Key.showKeys, \.showKeys),
    ]
    for (key, path) in toggles where defaults.object(forKey: key) != nil {
      settings[keyPath: path] = defaults.bool(forKey: key)
    }
    if let countdown = (defaults.object(forKey: Key.countdown) as? NSNumber)
      .flatMap({ RecordingCountdown(rawValue: $0.intValue) })
    {
      settings.countdown = countdown
    }
    if let quality = defaults.string(forKey: Key.quality).flatMap(RecordingQuality.init) {
      settings.quality = quality
    }
    if let fps = (defaults.object(forKey: Key.fps) as? NSNumber)
      .flatMap({ RecordingFrameRate(rawValue: $0.intValue) })
    {
      settings.frameRate = fps
    }
    if let after = defaults.string(forKey: Key.after).flatMap(RecordingAfterAction.init) {
      settings.after = after
    }
    if let folder = defaults.string(forKey: Key.saveFolder) {
      let recent = defaults.stringArray(forKey: Key.recentFolders) ?? []
      settings.folders = RecordingFolders(current: folder, recent: recent)
    }
    settings.folders = settings.folders.pruned(keeping: folderExists)
    return settings
  }

  public static func save(_ settings: RecordingSettings, to defaults: UserDefaults) {
    set(settings.microphone, Key.micDevice, in: defaults)
    set(settings.lastMicrophone, Key.lastMic, in: defaults)
    defaults.set(settings.systemAudio, forKey: Key.systemAudio)
    defaults.set(settings.showPointer, forKey: Key.showPointer)
    defaults.set(settings.showClicks, forKey: Key.showClicks)
    defaults.set(settings.showKeys, forKey: Key.showKeys)
    defaults.set(settings.countdown.rawValue, forKey: Key.countdown)
    defaults.set(settings.quality.rawValue, forKey: Key.quality)
    defaults.set(settings.frameRate.rawValue, forKey: Key.fps)
    defaults.set(settings.after.rawValue, forKey: Key.after)
    defaults.set(settings.folders.current, forKey: Key.saveFolder)
    defaults.set(settings.folders.recent, forKey: Key.recentFolders)
  }

  /// Whether a folder (not a file) is at `path`.
  public static func isFolder(_ path: String) -> Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
      && isDirectory.boolValue
  }

  /// A device ID, or no key for none (nothing stored reads as none).
  private static func set(_ value: String?, _ key: String, in defaults: UserDefaults) {
    if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
  }

  private enum Key {
    static let prefix = RecordingSettingsMemory.prefix
    static let micDevice = prefix + "micDevice"
    static let lastMic = prefix + "lastMic"
    static let systemAudio = prefix + "systemAudio"
    static let showPointer = prefix + "showPointer"
    static let showClicks = prefix + "showClicks"
    static let showKeys = prefix + "showKeys"
    static let countdown = prefix + "countdown"
    static let quality = prefix + "quality"
    static let fps = prefix + "fps"
    static let after = prefix + "after"
    static let saveFolder = prefix + "saveFolder"
    static let recentFolders = prefix + "recentFolders"
  }
}
