import AICore
import Foundation

/// The long screenshot's copy on the island in the shell language (``IslandLabels/longScreenshot``),
/// built again when it changes. Restore, Attach, the footer's working label and the lightbox side
/// panel's hide button are the recording card's words, as its ask field and answer slot are
/// (``IslandAskLabels``). Formatted copy is built per use, since its values (sizes, counts) change
/// while the copy does not.
struct IslandLongScreenshotLabels: Equatable {
  var processing = ""
  var title = ""
  var trimmed = ""
  var restore = ""
  var restoreTooltip = ""
  var preview = ""
  var trimTop = ""
  var trimBottom = ""
  var reads = ""
  var readsInfo = ""
  var noText = ""
  /// Cover Sensitive Info (decision D7); its tooltip lists the kinds (``coverTooltip(_:)``).
  var cover = ""
  var annotate = ""
  var annotateTooltip = ""
  var copy = ""
  var copyTooltip = ""
  var attach = ""
  var attachTooltip = ""
  var actionWorking = ""
  // The full-screen preview (the lightbox).
  var lightbox = ""
  var lightboxTooltip = ""
  var back = ""
  var backTooltip = ""
  var previousPage = ""
  var nextPage = ""
  var zoomIn = ""
  var zoomOut = ""
  var zoomTooltip = ""
  var fit = ""
  var hintScroll = ""
  var hintZoom = ""
  var overview = ""
  var viewportTooltip = ""
  var done = ""
  var doneTooltip = ""
  // The lightbox's text mode and text command row.
  var select = ""
  var selectTooltip = ""
  var textDoneTooltip = ""
  var hintMarquee = ""
  var hintPan = ""
  var hintExit = ""
  var textRow = ""
  var textCopy = ""
  var textCopyTooltip = ""
  var running = ""
  // The lightbox's side panel with the text commands' result.
  var results = ""
  var resultsTooltip = ""
  var hidePanel = ""
  /// The ask field's and answer slot's copy, with the long screenshot's quick asks.
  var asking = IslandAskLabels<LongScreenshotQuickAsk>()

  static func current() -> IslandLongScreenshotLabels {
    let text: (LongScreenshotCardStringKey) -> String = { ShellStrings.shared.text($0) }
    let recording: (RecordingIslandStringKey) -> String = { ShellStrings.shared.text($0) }
    let lightboxText: (LongScreenshotTextStringKey) -> String = { ShellStrings.shared.text($0) }
    return IslandLongScreenshotLabels(
      processing: text(.processing), title: text(.title), trimmed: text(.trimmed),
      restore: recording(.restore), restoreTooltip: text(.restoreTooltip),
      preview: text(.preview), trimTop: text(.trimTop), trimBottom: text(.trimBottom),
      reads: text(.reads), readsInfo: text(.readsInfo), noText: text(.noText),
      cover: text(.cover), annotate: text(.annotate),
      annotateTooltip: text(.annotateTooltip), copy: text(.copy), copyTooltip: text(.copyTooltip),
      attach: recording(.attach), attachTooltip: recording(.attachTooltip),
      actionWorking: recording(.actionWorking), lightbox: text(.lightbox),
      lightboxTooltip: text(.lightboxTooltip), back: text(.back), backTooltip: text(.backTooltip),
      previousPage: text(.previousPage), nextPage: text(.nextPage), zoomIn: text(.zoomIn),
      zoomOut: text(.zoomOut), zoomTooltip: text(.zoomTooltip), fit: text(.fit),
      hintScroll: text(.hintScroll), hintZoom: text(.hintZoom), overview: text(.overview),
      viewportTooltip: text(.viewportTooltip), done: text(.done), doneTooltip: text(.doneTooltip),
      select: lightboxText(.select), selectTooltip: lightboxText(.selectTooltip),
      textDoneTooltip: lightboxText(.doneTooltip), hintMarquee: lightboxText(.hintMarquee),
      hintPan: lightboxText(.hintPan), hintExit: lightboxText(.hintExit),
      textRow: lightboxText(.row),
      textCopy: ShellStrings.shared.text(CaptureCommandsStringKey.captureCommandsCopyText),
      textCopyTooltip: lightboxText(.copyTooltip), running: lightboxText(.running),
      results: lightboxText(.results), resultsTooltip: lightboxText(.resultsTooltip),
      hidePanel: recording(.lightboxHidePanel),
      asking: .current(
        placeholder: text(.askPlaceholder), label: text(.askLabel), question: text(.askDefault),
        quickAsks: [
          .summary: text(.quickSummary), .table: text(.quickTable), .keyInfo: text(.quickKeyInfo),
        ]))
  }

  /// The title row's subtitle: the image's width and the kept height in points, the screens the
  /// kept range spans, "Trimmed" once trimmed, and the app it was taken in.
  func subtitle(_ state: LongScreenshotCardState) -> String {
    let size =
      Self.points(state.source.shot.pointSize.width) + " × " + Self.points(state.kept.height)
    let screens = ShellStrings.shared.text(
      LongScreenshotCardStringKey.screens, LongScreenshotChromeCopy.screens(state.screens))
    return
      ([size, screens] + (state.isTrimmed ? [trimmed] : [])
      + (state.source.shot.appName.map { [$0] } ?? [])).joined(separator: " · ")
  }

  /// The card for VoiceOver, with its subtitle.
  func card(_ subtitle: String) -> String {
    ShellStrings.shared.text(LongScreenshotCardStringKey.card, subtitle)
  }

  /// A page row's label: "Page 2".
  func page(_ number: Int) -> String {
    ShellStrings.shared.text(LongScreenshotCardStringKey.page, String(number))
  }

  /// What is sent besides the image: "Recognized 42 lines and 1,234 characters, …".
  func recognized(lines: Int, characters: Int) -> String {
    let strings = ShellStrings.shared
    return Self.format(
      .recognized, strings.text(LongScreenshotCardStringKey.lines, count: lines),
      strings.text(LongScreenshotCardStringKey.characters, count: characters))
  }

  /// The sensitive row: the kinds in the kept range with their counts, those still uncovered or
  /// all of them once every one is covered.
  func sensitive(_ counts: [LongScreenshotSensitiveCount], covered: Bool) -> String {
    ShellStrings.shared.text(
      covered ? LongScreenshotCardStringKey.sensitiveCovered : .sensitiveFound, Self.kinds(counts))
  }

  /// Cover Sensitive Info's tooltip: "Cover each with a mosaic: 2 email addresses, 1 phone
  /// number", the kinds still uncovered.
  func coverTooltip(_ counts: [LongScreenshotSensitiveCount]) -> String {
    ShellStrings.shared.text(LongScreenshotCardStringKey.coverTooltip, Self.kinds(counts))
  }

  /// Cover Sensitive Info's confirmation in place of its label: "Covered 3 items".
  static func covered(_ count: Int) -> String {
    ShellStrings.shared.text(CaptureCommandsStringKey.captureRedactDone, count: count)
  }

  /// A text command's tooltip: "Run “Translate” on this text".
  func runTooltip(_ name: String) -> String {
    ShellStrings.shared.text(LongScreenshotTextStringKey.runTooltip, name)
  }

  /// The lightbox's page counter: "Page 2 of 7".
  func page(_ number: Int, of count: Int) -> String {
    Self.format(.pageOf, String(number), String(count))
  }

  /// A trim bar's tab on the lightbox: "Start · 1,234 pt", `points` as ``points(_:)`` writes
  /// them.
  func trimTab(_ edge: LongScreenshotCardState.Edge, _ points: String) -> String {
    let value = ShellStrings.shared.text(LongScreenshotCardStringKey.keptHeight, points)
    return ShellStrings.shared.text(
      edge == .top ? LongScreenshotCardStringKey.trimStart : .trimEnd, value)
  }

  /// The kinds found with their counts, as one list in the shell language.
  private static func kinds(_ counts: [LongScreenshotSensitiveCount]) -> String {
    let strings = ShellStrings.shared
    return counts.map { strings.text(Self.key(for: $0.kind), count: $0.count) }
      .joined(separator: strings.text(LongScreenshotCardStringKey.kindSeparator))
  }

  /// An answer's range: the kept height, "1,234 pt".
  func keptHeight(_ kept: LongScreenshotKept) -> String {
    ShellStrings.shared.text(LongScreenshotCardStringKey.keptHeight, Self.points(kept.height))
  }

  /// Whole points as the live chrome writes them: grouped, the same in every language.
  static func points(_ value: CGFloat) -> String {
    Int(value.rounded()).formatted(.number.locale(Locale(identifier: "en_US")))
  }

  private static func key(for kind: SensitiveText.Kind) -> LongScreenshotCardStringKey {
    switch kind {
    case .email: .kindEmail
    case .phone: .kindPhone
    case .key: .kindKey
    case .card: .kindCard
    }
  }

  private static func format(_ key: LongScreenshotCardStringKey, _ arguments: String...) -> String {
    let strings = ShellStrings.shared
    return String(
      format: strings.text(key), locale: Locale(identifier: strings.language.rawValue),
      arguments: arguments)
  }
}
