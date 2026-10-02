import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Selection toolbar")
struct SelectionToolbarTests {
  static func context(
    enabled: Bool = true, trusted: Bool = true, app: String? = "com.apple.Safari",
    excluded: Set<String> = [], secure: Bool = false
  ) -> SelectionToolbarContext {
    SelectionToolbarContext(
      enabled: enabled, trusted: trusted, frontmostBundleId: app,
      ownBundleId: "com.junerdd.ai.dev", excludedBundleIds: excluded, secureInput: secure)
  }

  @Test("Only a drag, a double or triple click, or a shift-click may have selected text")
  func gestures() {
    let down = CGPoint(x: 100, y: 100)
    #expect(!SelectionGesture.mayHaveSelected(down: down, up: down, clickCount: 1, shift: false))
    #expect(
      !SelectionGesture.mayHaveSelected(
        down: down, up: CGPoint(x: 102, y: 102), clickCount: 1, shift: false))
    #expect(
      SelectionGesture.mayHaveSelected(
        down: down, up: CGPoint(x: 140, y: 100), clickCount: 1, shift: false))
    #expect(SelectionGesture.mayHaveSelected(down: down, up: down, clickCount: 2, shift: false))
    #expect(SelectionGesture.mayHaveSelected(down: down, up: down, clickCount: 3, shift: false))
    #expect(SelectionGesture.mayHaveSelected(down: down, up: down, clickCount: 1, shift: true))
    #expect(!SelectionGesture.mayHaveSelected(down: nil, up: down, clickCount: 1, shift: false))
  }

  @Test("No check while off, untrusted, under secure input, in Atd or an excluded app")
  func shouldProbe() {
    #expect(SelectionToolbarRules.shouldProbe(Self.context()))
    #expect(SelectionToolbarRules.shouldProbe(Self.context(app: nil)))
    #expect(!SelectionToolbarRules.shouldProbe(Self.context(enabled: false)))
    #expect(!SelectionToolbarRules.shouldProbe(Self.context(trusted: false)))
    #expect(!SelectionToolbarRules.shouldProbe(Self.context(secure: true)))
    #expect(!SelectionToolbarRules.shouldProbe(Self.context(app: "com.junerdd.ai.dev")))
    #expect(
      !SelectionToolbarRules.shouldProbe(
        Self.context(app: "com.apple.Safari", excluded: ["com.apple.Safari"])))
  }

  @Test("Only a non-empty selection shows the toolbar; a secure field never does")
  func shows() {
    #expect(SelectionToolbarRules.shows(.selected(length: 5, bounds: nil)))
    #expect(!SelectionToolbarRules.shows(.selected(length: 0, bounds: nil)))
    #expect(!SelectionToolbarRules.shows(.secureField))
    #expect(!SelectionToolbarRules.shows(.none))
  }

  @Test("The pointer may wander 120 pt from the toolbar before it goes")
  func dismissal() {
    let bar = ScreenRect(x: 100, y: 100, width: 200, height: 36)
    #expect(!SelectionToolbarRules.pointerLeft(bar, x: 150, y: 120))
    #expect(!SelectionToolbarRules.pointerLeft(bar, x: 420, y: 118))
    #expect(SelectionToolbarRules.pointerLeft(bar, x: 421, y: 118))
    #expect(SelectionToolbarRules.pointerLeft(bar, x: 390, y: 236 + 1))
  }

  @Test("The toolbar settings mirror toolbar.set")
  func settings() {
    let settings = SelectionToolbarSettings(
      ToolbarSetParams(
        enabled: true, excludedBundleIds: ["a", "a", "b"],
        commands: [.init(id: "c1", name: "Translate")]))
    #expect(settings.excludedBundleIds == ["a", "b"])
    #expect(settings.commands == [.init(id: "c1", name: "Translate")])
  }

  // MARK: Placement

  static let size = WindowSize(width: 200, height: 36)
  static let main = SelectionToolbarPlacement.Display(
    frame: ScreenRect(x: 0, y: 0, width: 1440, height: 900),
    workArea: ScreenRect(x: 0, y: 0, width: 1440, height: 875))
  /// A display left of and below the main one: negative origins.
  static let left = SelectionToolbarPlacement.Display(
    frame: ScreenRect(x: -1280, y: -300, width: 1280, height: 800),
    workArea: ScreenRect(x: -1280, y: -300, width: 1280, height: 800))

  static func place(
    _ selection: ScreenRect?, pointer: CGPoint,
    displays: [SelectionToolbarPlacement.Display] = [main, left]
  )
    -> ScreenRect?
  {
    SelectionToolbarPlacement.frame(
      size: size, selection: selection, pointer: pointer, displays: displays)
  }

  @Test("Centered 8 pt above the selection")
  func above() {
    let frame = Self.place(
      ScreenRect(x: 500, y: 400, width: 100, height: 20), pointer: CGPoint(x: 600, y: 410))
    #expect(frame == ScreenRect(x: 450, y: 428, width: 200, height: 36))
  }

  @Test("Below the selection when the top of the work area leaves no room")
  func flipsBelow() {
    let frame = Self.place(
      ScreenRect(x: 500, y: 840, width: 100, height: 20), pointer: CGPoint(x: 600, y: 850))
    #expect(frame == ScreenRect(x: 450, y: 796, width: 200, height: 36))
  }

  @Test("Clamped 8 pt inside the work area at its edges")
  func clampedAtEdges() {
    let leftEdge = Self.place(
      ScreenRect(x: 0, y: 400, width: 40, height: 20), pointer: CGPoint(x: 10, y: 410))
    #expect(leftEdge?.x == 8)
    let rightEdge = Self.place(
      ScreenRect(x: 1420, y: 400, width: 20, height: 20), pointer: CGPoint(x: 1430, y: 410))
    #expect(rightEdge?.x == 1232)
  }

  @Test("A selection on a display with negative coordinates stays on that display")
  func negativeCoordinates() {
    let frame = Self.place(
      ScreenRect(x: -1270, y: -290, width: 60, height: 18), pointer: CGPoint(x: -1250, y: -280))
    #expect(frame == ScreenRect(x: -1272, y: -264, width: 200, height: 36))
  }

  @Test("Without usable bounds, the pointer's line anchors the toolbar")
  func pointerFallback() {
    let expected = ScreenRect(x: 200, y: 518, width: 200, height: 36)
    #expect(Self.place(nil, pointer: CGPoint(x: 300, y: 500)) == expected)
    // Zero bounds, as some apps answer, lie on no display's middle and give way too.
    #expect(
      Self.place(ScreenRect(x: 0, y: 0, width: 0, height: 0), pointer: CGPoint(x: 300, y: 500))
        == expected)
    // Bounds off every display (a stale answer) as well.
    #expect(
      Self.place(
        ScreenRect(x: 5000, y: 5000, width: 50, height: 20), pointer: CGPoint(x: 300, y: 500))
        == expected)
  }

  @Test("A selection taller than the room on either side gives way to the pointer")
  func tallSelection() {
    let frame = Self.place(
      ScreenRect(x: 100, y: 20, width: 600, height: 840), pointer: CGPoint(x: 400, y: 300))
    #expect(frame == ScreenRect(x: 300, y: 318, width: 200, height: 36))
  }

  @Test("A display smaller than the toolbar keeps its left and bottom margins")
  func smallDisplay() {
    let tiny = SelectionToolbarPlacement.Display(
      frame: ScreenRect(x: 0, y: 0, width: 150, height: 40),
      workArea: ScreenRect(x: 0, y: 0, width: 150, height: 40))
    let frame = Self.place(
      ScreenRect(x: 10, y: 10, width: 50, height: 10), pointer: CGPoint(x: 30, y: 15),
      displays: [tiny])
    #expect(frame == ScreenRect(x: 8, y: 8, width: 200, height: 36))
    #expect(Self.place(nil, pointer: CGPoint(x: 0, y: 0), displays: []) == nil)
  }

  // MARK: Layout

  @Test(
    "Commands get buttons while the toolbar, grip included, fits 420 pt; the rest go behind More")
  func visibleCommands() {
    // 8 padding + 16 grip + 2 + 80 ask: room for 314 pt of commands and gaps without More.
    #expect(SelectionToolbarLayout.visibleCommandCount(askWidth: 80, commandWidths: []) == 0)
    #expect(
      SelectionToolbarLayout.visibleCommandCount(askWidth: 80, commandWidths: [100, 100, 108])
        == 3)
    // One more point overflows: More (28 + 2) takes room, so only two fit.
    #expect(
      SelectionToolbarLayout.visibleCommandCount(askWidth: 80, commandWidths: [100, 100, 109])
        == 2)
    #expect(
      SelectionToolbarLayout.visibleCommandCount(askWidth: 80, commandWidths: [320, 40]) == 0)
    #expect(
      SelectionToolbarLayout.visibleCommandCount(
        askWidth: 80, commandWidths: Array(repeating: 60, count: 10)) == 4)
  }
}
