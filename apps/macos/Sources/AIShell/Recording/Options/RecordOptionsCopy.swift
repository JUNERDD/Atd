import AICore
import Foundation

/// The record bar's copy and glyphs, in the shell language: the names of the settings' values
/// as its menus show them and the Sound button's description. Read when a menu builds, so a
/// language change shows the next time it opens.
enum RecordOptionsCopy {
  static func text(_ key: RecordingOptionsStringKey) -> String {
    ShellStrings.shared.text(key)
  }

  /// "Name (key)", the capture tooltips' form.
  static func tooltip(_ name: String, key: String) -> String {
    String(format: ShellStrings.shared.text(.captureTooltipShortcut), name, key)
  }

  /// What the recording will hear: the Sound button's glyph (the microphone when it records
  /// one, the speaker when it hears only the system, a slashed microphone when it hears nothing)
  /// and the full description its tooltip and VoiceOver give.
  static func sound(microphone: RecordingMicrophone?, systemAudio: Bool)
    -> (glyph: String, description: String)
  {
    let glyph =
      microphone != nil
      ? RecordOptionsIcons.microphone
      : systemAudio ? RecordOptionsIcons.systemAudio : RecordOptionsIcons.silent
    let heard = microphone.map { format(.soundMicrophone, $0.name) } ?? text(.soundNoMicrophone)
    let system = text(systemAudio ? .soundSystemAudio : .soundNoSystemAudio)
    return (glyph, format(.soundSummary, heard, system))
  }

  static func countdown(_ countdown: RecordingCountdown) -> String {
    countdown == .none ? text(.countdownNone) : format(.countdownSeconds, countdown.seconds)
  }

  /// The quality's name; `long` adds what it is for, as its submenu row says it.
  static func quality(_ quality: RecordingQuality, long: Bool = false) -> String {
    switch quality {
    case .hd720: long ? format(.qualitySmaller, quality.rawValue) : quality.rawValue
    case .hd1080: quality.rawValue
    case .original:
      long ? format(.qualitySharpest, text(.qualityOriginal)) : text(.qualityOriginal)
    }
  }

  static func frameRate(_ frameRate: RecordingFrameRate) -> String {
    format(.frameRateValue, frameRate.framesPerSecond)
  }

  static func estimate(megabytesPerMinute: Int) -> String {
    format(.estimateValue, megabytesPerMinute)
  }

  static func after(_ after: RecordingAfterAction) -> String {
    switch after {
    case .card: text(.afterCard)
    case .save: text(.afterSave)
    case .attach: text(.afterAttach)
    }
  }

  /// A folder's name as the menu lists it: a standard folder by the app's name for it, any
  /// other as Finder shows it.
  static func folderName(_ path: String) -> String {
    switch RecordingFolders.Standard(path: path) {
    case .movies: text(.folderMovies)
    case .desktop: text(.folderDesktop)
    case .documents: text(.folderDocuments)
    case nil: FileManager.default.displayName(atPath: path)
    }
  }

  private static func format(_ key: RecordingOptionsStringKey, _ arguments: any CVarArg...)
    -> String
  {
    String(
      format: text(key), locale: Locale(identifier: ShellStrings.shared.language.rawValue),
      arguments: arguments)
  }
}

/// The record bar's Lucide glyphs, template image sets in the App target's asset catalog
/// (`App/Assets.xcassets/Recording/lucide-<name>.imageset`), found by ``AnnotationIcons/glyph(_:label:)``.
/// Source: `mic`, `mic-off`, `volume-2` and `circle-dot` carry the paths of the installed
/// `lucide-react` 1.61.0 (ISC), the version pinned in `pnpm-workspace.yaml`
/// (`dist/esm/icons/<name>.mjs`); `sliders-horizontal` is the Island's set, `x` and
/// `grip-vertical` the annotation toolbar's.
enum RecordOptionsIcons {
  static let microphone = "mic"
  static let silent = "mic-off"
  static let systemAudio = "volume-2"
  static let options = "sliders-horizontal"
  static let start = "circle-dot"
}
