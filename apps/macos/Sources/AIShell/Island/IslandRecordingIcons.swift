/// The recording's glyphs on the island, Lucide template image sets in the App target's asset
/// catalog found by name as every island glyph is (``IslandGlyph``). `play`, `pause` and
/// `sparkles` are the selection toolbar's sets, `app-window`, `message-square` and `arrow-up`
/// the task activity's, `square-text`, `copy` and `arrow-up-right` the capture toolbar's (asset
/// names are global in the catalog). The others (`mic`, `mic-off`, `trash`, `square-filled`,
/// `maximize-2`, `list`, `mouse-pointer-click`, `keyboard`, `save`, `shield-check`) are in
/// `App/Assets.xcassets/Island`, carrying the paths of the installed `lucide-react` 1.61.0 (ISC);
/// its `trash-2` is an alias of `trash`. `square-filled` uses Square's unchanged geometry with
/// a foreground fill, matching the conversation composer's Stop.
extension IslandIcons {
  static let microphone = "mic"
  static let microphoneOff = "mic-off"
  static let play = "play"
  static let pause = "pause"
  static let discard = "trash"
  static let stop = "square-filled"
  /// The card's full screen preview, and the preview's steps panel toggle.
  static let fullScreen = "maximize-2"
  static let steps = "list"
  static let sparkles = "sparkles"
  static let send = "arrow-up"
  static let save = "save"
  static let copy = "copy"
  static let open = "arrow-up-right"
  static let reads = "shield-check"
  static let close = "x"
}
