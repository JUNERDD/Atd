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

  @Test("The toolbar settings mirror toolbar.set")
  func settings() {
    let settings = SelectionToolbarSettings(
      ToolbarSetParams(
        enabled: true, activation: .hold, activationKeys: [.option, .shift, .option],
        showHud: false,
        excludedBundleIds: ["a", "a", "b"], commands: [.init(id: "c1", name: "Translate")]))
    #expect(settings.activation == SelectionActivation(mode: .hold, keys: [.option, .shift]))
    #expect(!settings.showHud)
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

  @Test("A menu's height counts its hairlines with its rows")
  func menuSize() {
    let size = SelectionToolbarMenuLayout.size(rowWidth: 100, rowCount: 3, separatorCount: 1)
    // 3 × 28 rows + 9 hairline + 3 × 2 gaps + 2 × 4 padding.
    #expect(size == WindowSize(width: 108, height: 107))
  }

  // MARK: Submenus

  static let submenu = WindowSize(width: 150, height: 100)
  static let parent = ScreenRect(x: 400, y: 300, width: 200, height: 160)
  static func row(in parent: ScreenRect) -> ScreenRect {
    ScreenRect(x: parent.x + 4, y: parent.maxY - 4 - 28, width: parent.width - 8, height: 28)
  }

  static func side(
    _ parent: ScreenRect, size: WindowSize = submenu,
    displays: [SelectionToolbarPlacement.Display] = [main, left]
  ) -> ScreenRect? {
    SelectionToolbarSubmenuPlacement.frame(
      size: size, row: row(in: parent), parent: parent, displays: displays)
  }

  @Test("A submenu opens 4 pt right of its menu, its first row level with the row that opened it")
  func submenuRight() {
    // The row's top is 456; the list starts 4 pt below the panel's top.
    #expect(Self.side(Self.parent) == ScreenRect(x: 604, y: 360, width: 150, height: 100))
  }

  @Test("A submenu with no room on the right opens on the left")
  func submenuFlipsLeft() {
    let parent = ScreenRect(x: 1200, y: 300, width: 200, height: 160)
    #expect(Self.side(parent)?.x == 1046)
  }

  @Test("A submenu with room on neither side takes the wider one, kept inside the work area")
  func submenuClamped() {
    let wide = WindowSize(width: 700, height: 100)
    // 392 pt free on the left, 332 on the right: left, pushed to the margin.
    let leftHeavy = Self.side(ScreenRect(x: 400, y: 300, width: 700, height: 160), size: wide)
    #expect(leftHeavy?.x == 8)
    // 292 pt on the left, 432 on the right: right, pushed back over the menu.
    let rightHeavy = Self.side(ScreenRect(x: 300, y: 300, width: 700, height: 160), size: wide)
    #expect(rightHeavy?.x == 732)
  }

  @Test("A submenu stays inside the work area vertically, shortened when taller than it")
  func submenuVertical() {
    let low = Self.side(ScreenRect(x: 400, y: 10, width: 200, height: 60))
    #expect(low?.y == 8)
    let tall = Self.side(Self.parent, size: WindowSize(width: 150, height: 2000))
    #expect(tall?.y == 8)
    #expect(tall?.height == 859)
  }

  @Test("A submenu on a display with negative coordinates stays on it")
  func submenuNegative() {
    let parent = ScreenRect(x: -400, y: -200, width: 200, height: 160)
    #expect(Self.side(parent) == ScreenRect(x: -196, y: -140, width: 150, height: 100))
    let edge = ScreenRect(x: -400, y: -200, width: 350, height: 160)
    #expect(Self.side(edge)?.x == -554)
    #expect(Self.side(Self.parent, displays: []) == nil)
  }

  // MARK: Options

  static let output = CommandOutputOption(value: .replaceSelection, saved: .panel, selection: false)
  static let names = CommandOutputChoice.Names(
    label: "Answer",
    actions: [
      .panel: "Panel", .replaceSelection: "Replace", .insertAfterSelection: "After",
      .insertAtCursor: "Cursor", .copy: "Copy",
    ], saved: "%@ (default)")
  static let entry = CommandOptionsCatalog.Entry(
    id: "c1", name: "Translate",
    options: [
      .choice(
        .init(
          key: "lang", label: "Language", value: "en",
          options: [.init(value: "en", label: "English"), .init(value: "fr", label: "French")])),
      .toggle(.init(key: "formal", label: "Formal", value: false)),
      .input(.init(key: "note", label: "Note")),
    ], output: output)

  @Test("Picks and flips change the sheet; every launch carries all choice and toggle values")
  func sheet() {
    var sheet = ToolbarOptionsSheet(Self.entry, names: Self.names)
    #expect(sheet.singleChoice == nil)
    #expect(sheet.summary == "English")
    sheet.pick("fr", for: "lang")
    sheet.pick("xx", for: "lang")
    sheet.flip("formal")
    sheet.flip("note")
    sheet.pick("copy", for: CommandOutputChoice.key)
    #expect(sheet.summary == "French · Formal")
    // A choice without a value adds nothing to the line.
    var unset = ToolbarOptionsSheet(
      .init(
        id: "c3", name: "Tone",
        options: [
          .choice(
            .init(key: "tone", label: "Tone", value: "", options: [.init(value: "a", label: "A")])),
          .toggle(.init(key: "formal", label: "Formal", value: true)),
        ], output: Self.output), names: Self.names)
    #expect(unset.summary == "Formal")
    unset.pick("a", for: "tone")
    #expect(unset.summary == "A · Formal")
    let launch = sheet.launch(.edit)
    #expect(launch.id == "c1" && launch.intent == .edit)
    #expect(
      launch.arguments
        == CommandArguments(output: .copy, choices: ["lang": "fr"], toggles: ["formal": true]))
    // Where the answer goes is one more row, so only a command without parameters lists values.
    let single = ToolbarOptionsSheet(
      .init(id: "c2", name: "Tone", options: [Self.entry.options[0]], output: Self.output),
      names: Self.names)
    #expect(single.singleChoice == nil)
    let bare = ToolbarOptionsSheet(
      .init(id: "c4", name: "Fix", options: [], output: Self.output), names: Self.names)
    #expect(bare.singleChoice?.key == CommandOutputChoice.key)
    // Without the selection, the actions on it are left out; the saved one is the default.
    #expect(
      bare.singleChoice?.options.map(\.label) == ["Panel (default)", "Cursor", "Copy"])
  }

  @Test(
    "A submenu opens after 90 ms of rest and survives the way into it; another row takes 180 ms")
  func submenuIntent() {
    var intent = ToolbarOptionsSubmenuIntent()
    #expect(intent.update(.row(0, opens: true), at: 0) == nil)
    #expect(intent.update(.row(0, opens: true), at: 0.05) == nil)
    #expect(intent.update(.row(0, opens: true), at: 0.09) == .open(0))
    // Crossing row 1 on the way into the submenu keeps it.
    #expect(intent.update(.row(1, opens: true), at: 0.2) == nil)
    #expect(intent.update(.inSubmenu, at: 0.3) == nil)
    #expect(intent.update(.away, at: 1) == nil)
    #expect(intent.openRow == 0)
    // Resting on another row swaps the submenu, on a row without one closes it.
    #expect(intent.update(.row(1, opens: true), at: 2) == nil)
    #expect(intent.update(.row(1, opens: true), at: 2.2) == .open(1))
    #expect(intent.update(.row(2, opens: false), at: 3) == nil)
    #expect(intent.update(.row(2, opens: false), at: 3.2) == .close)
    #expect(intent.openRow == nil)
    intent.opened(2)
    intent.closed()
    #expect(intent.update(.row(2, opens: false), at: 4) == nil)
    #expect(intent.update(.row(2, opens: false), at: 5) == nil)
  }
}
