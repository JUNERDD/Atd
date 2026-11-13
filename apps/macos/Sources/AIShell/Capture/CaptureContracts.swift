import AICore
import AppKit
import CoreGraphics

// The seams of a capture session (`screenshot.capture`). The session owns the frozen displays,
// the overlay windows and the selection; element detection and annotation plug in through the
// protocols below. Every rect is in points unless a name says pixels. "Quartz" points are global
// with the origin at the top-left of the primary display and y down (AX, CGWindowList and
// ScreenCaptureKit use them); "desktop" points are the session's (``CaptureDesktop``): Quartz
// points minus the top-left of every display's union, y down. Each overlay view's flipped
// coordinates are desktop points, so a selection or an annotation keeps one rect across displays.

/// One display frozen at the start of a session.
nonisolated struct FrozenDisplay {
  let displayID: CGDirectDisplayID
  /// The display's bounds in Quartz points (`CGDisplayBounds`); may have a negative origin.
  let quartzFrame: CGRect
  /// The display's pixels with the app's own windows excluded, origin top-left.
  let image: CGImage

  /// Image pixels per point on this display.
  var pixelScale: CGFloat { CGFloat(image.width) / quartzFrame.width }

  /// The display as the desktop geometry sees it.
  var geometry: CaptureDesktop.Display {
    CaptureDesktop.Display(
      id: displayID, quartzFrame: quartzFrame, pixelWidth: image.width, pixelHeight: image.height)
  }
}

/// Frozen pixels under a selection, which mosaics sample: `scale` pixels per desktop point,
/// with the image's top-left at the desktop point `origin`.
nonisolated struct CaptureBackdrop {
  let image: CGImage
  let scale: CGFloat
  let origin: CGPoint
  /// The displays the image holds, in desktop points; it is transparent between them, and
  /// mosaics are drawn only within them so those gaps stay transparent in the export.
  let frames: [CGRect]

  /// One display's own image, opaque throughout; a composed one may have transparent gaps.
  var isOpaque: Bool { frames.count == 1 }
}

/// A window on screen when the session started, front to back. Taken before any overlay
/// appears, so the session decides which app is under a point (AX hit-testing cannot: it would
/// answer with the overlay).
nonisolated struct CaptureWindow: Equatable, Sendable {
  let windowID: CGWindowID
  let pid: pid_t
  /// Window bounds in Quartz points.
  let quartzFrame: CGRect
  /// `kCGWindowLayer`.
  let layer: Int
}

/// What element detection can offer for this session.
nonisolated enum ElementDetection: Equatable, Sendable {
  /// Accessibility is trusted: elements inside windows are detected.
  case elements
  /// Accessibility is not trusted: only whole windows are offered, and the overlay shows the
  /// `capture.hint.accessibility` hint.
  case windowsOnly
}

/// What Accessibility says about one detected interface element, for the screen-context
/// attachment. Strings are as the app reports them, trimmed; empty ones are nil.
nonisolated struct ElementDescription: Equatable, Sendable {
  /// The AX role, e.g. `AXButton`.
  let role: String
  /// `AXTitle`, else `AXDescription`.
  let title: String?
  /// `AXValue` when it is text or a number, bounded.
  let value: String?
  /// `AXHelp`.
  let help: String?
}

/// Candidate areas under the pointer. Implementations run their Accessibility work off the main
/// actor and hand back plain rects only.
nonisolated protocol ElementTargeting: Sendable {
  /// Starts a session over `windows` (front to back, the app's own windows already removed).
  func begin(windows: [CaptureWindow]) async -> ElementDetection
  /// The areas containing `point` (Quartz), smallest first and ending with the window; empty
  /// when no window is there (the session then offers the display). Each rect lies within its
  /// window and the displays it shows on (a window spanning displays comes whole only when
  /// displays share Spaces; otherwise it is cut to the display under the point). A call may be
  /// superseded by a later one: callers keep the latest answer.
  func targets(at point: CGPoint) async -> [CGRect]
  /// The element among `targets(at: point)` whose frame is `frame` (Quartz), described; nil for
  /// a window, the display, or when Accessibility cannot tell. Called once, when the selection is
  /// confirmed, for a selection committed from a detected element.
  func describe(at point: CGPoint, frame: CGRect) async -> ElementDescription?
  /// The scroll area a screenshot selection lies over (`selection` and the answer in Quartz
  /// points), for the long screenshot (decision D5): its visible frame and its vertical scroll
  /// value; nil when nothing there scrolls or Accessibility cannot tell. Asked once per settled
  /// selection of a session that offers the long screenshot, while elements are detected.
  func scrollArea(around selection: CGRect) async -> LongScreenshotScrollArea?
  /// Ends the session and restores any state it changed in other apps.
  func end() async
}

/// The annotation step on a committed selection, hosted by the overlay views of every display
/// (a selection may span them). The selection stays adjustable the whole time (its handles and
/// edge band always belong to the session), so annotation geometry is in desktop points: an
/// annotation stays where it was drawn on the screen while the selection moves or resizes, and
/// the selection only decides what is exported.
protocol AnnotationEditing: AnyObject {
  /// The user confirmed (toolbar or a shortcut the editor handles while it has focus).
  var onConfirm: (() -> Void)? { get set }
  /// The user cancelled from the toolbar.
  var onCancel: (() -> Void)? { get set }
  /// The user asked to copy the result instead of attaching it (toolbar or ⌘C).
  var onCopy: (() -> Void)? { get set }
  /// The user asked to save the result to a local folder (toolbar or ⌘S); nil when editing.
  var onSave: (() -> Void)? { get set }
  /// Display name of the current save folder for the Save button's tooltip; nil uses a generic label.
  var saveFolder: String? { get set }
  /// True while a tool is chosen or text mode is on: presses inside the selection (away from its
  /// handles and edge band) go to the editor. False: they move the selection, except where
  /// ``claimsPress(at:)`` holds. Called on every change.
  var onInteriorClaimChange: ((Bool) -> Void)? { get set }
  /// Whether anything is drawn; a right-click clears the selection back to idle only when not.
  var hasAnnotations: Bool { get }
  /// Set by the session before ``show(in:selection:backdrop:)``: the detected areas containing a
  /// point (desktop points, smallest first, each within the desktop), for tools that snap a
  /// shape to an interface element. Answers may come late; callers keep the latest.
  var elementTargets: ((CGPoint) async -> [CGRect])? { get set }
  /// Adds a canvas over `selection` (desktop points) to every host (one per display, whose
  /// points are desktop points), and the bars beside the selection on the host holding most of
  /// it. Mosaics sample what `backdrop` gives for the selection, asked again as it changes.
  func show(
    in hosts: [AnnotationHostView], selection: CGRect,
    backdrop: @escaping (CGRect) -> CaptureBackdrop?)
  /// The selection moved or was resized at any time; annotations stay put, the canvas and the
  /// bars follow the selection. While `dragging` (the mouse is still moving or resizing it) the
  /// bars keep the place beside it they took for as long as it fits
  /// (``AnnotationToolbarLayout/Anchor``); a settled change places them afresh.
  func selectionDidChange(_ selection: CGRect, dragging: Bool)
  /// Commits open text to the document, as clicking away from it does; nothing to do without
  /// any. The session calls it before it reads ``document`` or renders the annotations, so
  /// neither an export nor a switch to record mode loses what is being typed.
  func endText()
  /// Removes the canvas and the bars; annotations, and open text, are discarded.
  func hide()
  /// A scroll-wheel event anywhere over an overlay; true when the editor used it
  /// (to resize what the style bar targets), false to leave it to the session.
  func scroll(_ event: NSEvent) -> Bool
  /// The annotations in selection-local points (origin at the selection's top-left), for
  /// reopening this capture later (`screenshot.edit`).
  var document: AnnotationDocument { get }
  /// Replaces the annotations with `document` (selection-local points, as ``document`` gives
  /// them), placed on the current selection; one state, not an undo step. Called after `show`.
  func restore(_ document: AnnotationDocument)
  /// Draws the annotations inside the selection into `context`, which already holds the
  /// selection's pixels with the origin at its top-left, y down and one unit per pixel;
  /// `transform` maps desktop points to those pixels. Mosaics sample the backdrop the editor was
  /// shown with, so they read pixels beyond the selection's edge too.
  func render(into context: CGContext, transform: CGAffineTransform)
  /// The command row in the style bar's slot while nothing is styled (architecture S1); nil
  /// shows none (S8). Set before ``show(in:selection:backdrop:)``.
  var commandRow: CaptureCommandRowSetup? { get set }
  /// The command row or its ask field launched something: the session ends with it.
  var onLaunch: ((CaptureLaunch) -> Void)? { get set }
  /// What the bars beside the selection keep clear of (desktop points): set by the session
  /// before `show` and before every `selectionDidChange` it makes.
  var keepClear: AnnotationToolbarLayout.KeepClear { get set }
  /// The text recognized in the current selection (desktop points), nil while it is being read;
  /// the session sets it as recognition settles (S5).
  var recognizedText: CaptureText? { get set }
  /// Closes an open menu, or else the ask field; true when one closed, so the Escape or Return
  /// that asked goes no further.
  func dismissMenus() -> Bool
  /// The toolbar's long screenshot button (decisions D5, D7): nil hides it, for a session that
  /// does not offer the long screenshot; otherwise it is enabled only while `.available` and its
  /// tooltip says why not. Set by the session before ``show(in:selection:backdrop:)`` and again
  /// whenever the answer for the selection changes.
  var longScreenshot: LongScreenshotAvailability? { get set }
  /// The long screenshot button was clicked.
  var onLongScreenshot: (() -> Void)? { get set }
  /// Escape: steps back one level (an open menu or field, a running text command, open text, a
  /// gesture, a result card, text mode's picks, a selection, the tool); false when nothing was
  /// left, so the session cancels.
  func stepBack() -> Bool
  /// Whether a press at `point` inside an interior no tool claimed is still the editor's: a click
  /// on a numbered step a text command drew opens its result card. The session leaves such a
  /// press, and the cursor over it, to the editor.
  func claimsPress(at point: CGPoint) -> Bool
  /// The text a command or question launched from the capture also reads while text mode is on:
  /// what is picked, else what a text command would read (every available paragraph), unmasked
  /// only (decision D6); nil with text mode off or no text.
  var pickedText: String? { get }
  /// Set by the session before ``show(in:selection:backdrop:)``: the selection as it shows now,
  /// with its annotations, for Copy Screenshot (decision D9) and a text command's screenshot; nil
  /// when there is nothing to render.
  var renderSelection: (() -> CaptureSelectionShot?)? { get set }
  /// A text command's result card ended the capture (decision D10): the session ends with it.
  var onTextResult: ((CaptureTextHandoff) -> Void)? { get set }
}

/// The selection rendered as it shows (``AnnotationEditing/renderSelection``): its pixels with
/// the annotations at `scale` pixels per point, its size in points, and the app and window under
/// it for the screen context (each nil when unknown).
struct CaptureSelectionShot {
  let image: CGImage
  let scale: CGFloat
  let size: CGSize
  let app: String?
  let window: String?
}

/// What a text command's result card hands on as it ends the capture (decision D10), done once
/// the overlays are gone: open run `runId`'s task in Atd, or write `text` at the cursor the
/// capture recorded.
enum CaptureTextHandoff: Equatable {
  case open(runId: String)
  case insert(String)
}

/// What a screenshot session launches as it ends (architecture S1, S3, B2): a command placed on
/// the screenshot toolbar, run on the screenshot with the values its menu picked (none: the
/// remembered ones), or a question about it.
enum CaptureLaunch: Equatable {
  case command(CommandLaunch)
  case ask(String)
}

/// The screenshot toolbar's command row, for a session the screenshot shortcut or the mini panel
/// started (architecture S1, S2, S8).
struct CaptureCommandRowSetup {
  /// The commands placed on the screenshot toolbar, in order (`screenshotToolbar.set`).
  let commands: [SelectionToolbarSettings.Command]
  /// Their options (`commandOptions.set`); a command without an entry has no chevron.
  let catalog: CommandOptionsCatalog
  /// A command's option values picked in a menu, to remember (`commandOptions.picked`).
  let onPick: (String, CommandArguments) -> Void
  /// Puts recognized text on the clipboard (Copy text); false when the clipboard is busy.
  let copyText: (String) -> Bool
  /// More's last row: the session cancels and Settings › Commands opens once it is gone.
  let openSettings: () -> Void
  /// The field focused in front before the capture can take text, so an answer can go in at its
  /// cursor; set once the session read it (``CaptureSession/present(reopening:targetRead:)``).
  /// Without one the options menus leave Insert at cursor out (``CommandOutputChoice``).
  var cursor = false
  /// The app of that field, which a result card's Insert names.
  var cursorApp: String?
  /// The commands placed on `screenshotText` that read the selection, in order
  /// (`screenshotToolbar.set`'s `textCommands`): text mode's command row.
  var textCommands: [SelectionToolbarSettings.Command] = []
  /// Runs those commands while the capture stays open; nil runs none (text mode still picks and
  /// copies).
  var textRuns: CaptureTextRunner?
  /// Puts an image on the clipboard at its pixels per point (a result card's Copy Screenshot,
  /// decision D9); false when the clipboard is busy.
  var copyImage: (CGImage, CGFloat) -> Bool = { _, _ in false }
}

/// What recognition read in a selection's frozen pixels while it is edited (architecture S5,
/// S6), every box in desktop points.
struct CaptureText: Equatable {
  /// Every piece of text with its box.
  var boxes: [ScreenContext.TextBox]
  /// The parts of it that look sensitive (``SensitiveText``).
  var sensitive: [SensitiveText.Box]
  /// Where each piece's characters are, for text mode's selection by the character.
  var glyphs = CaptureTextGlyphs.empty

  /// Recognition failed or found nothing.
  static let empty = CaptureText(boxes: [], sensitive: [])
}
