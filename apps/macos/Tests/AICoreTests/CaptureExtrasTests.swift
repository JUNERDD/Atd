import Foundation
import Testing

@testable import AICore

@Suite("Screen context, recall, reopening and leading-edge resize")
struct CaptureExtrasTests {
  static let element = ScreenContext.Element(
    role: "AXButton", title: "Save", value: "  two\nlines ", help: "Saves the file")

  @Test("The context lists what is known and leaves unknown fields out")
  func contextMarkdown() {
    let full = ScreenContext(
      app: "Safari", window: "GitHub", element: Self.element, lines: ["Hello", "", "World"])
    #expect(
      full.markdown == """
        # Screen context

        - App: Safari
        - Window: GitHub
        - Picked element: AXButton "Save"
          - Value: two lines
          - Help: Saves the file

        ## Recognized text

        Hello
        World

        """)
    let textOnly = ScreenContext(app: nil, window: " ", element: nil, lines: ["Only text"])
    #expect(textOnly.markdown == "# Screen context\n\n## Recognized text\n\nOnly text\n")
    let factsOnly = ScreenContext(
      app: "Finder", window: nil,
      element: .init(role: "AXGroup", title: nil, value: nil, help: nil), lines: [])
    #expect(factsOnly.markdown == "# Screen context\n\n- App: Finder\n- Picked element: AXGroup\n")
    #expect(ScreenContext(app: nil, window: nil, element: nil, lines: [" "]).markdown == nil)
  }

  @Test("A long context is cut at a line to the character limit and marked")
  func contextCap() throws {
    let lines = (0..<2000).map { "Line number \($0) of recognized text" }
    let markdown = try #require(
      ScreenContext(app: "App", window: nil, element: nil, lines: lines).markdown)
    #expect(markdown.count <= ScreenContext.maxCharacters)
    #expect(markdown.hasSuffix("\n" + ScreenContext.truncationMarker + "\n"))
    let body = markdown.dropLast(ScreenContext.truncationMarker.count + 2)
    #expect(body.hasSuffix(" of recognized text"))
    let single = String(repeating: "x", count: 20_000)
    let cut = try #require(
      ScreenContext(app: nil, window: nil, element: nil, lines: [single]).markdown)
    #expect(cut.count == ScreenContext.maxCharacters)
    #expect(cut.hasSuffix(ScreenContext.truncationMarker + "\n"))
  }

  @Test("Recognized text reads in rows from top to bottom, each row left to right")
  func readingOrder() {
    func box(_ text: String, _ x: Double, _ y: Double, _ h: Double = 0.04) -> ScreenContext.TextBox
    {
      ScreenContext.TextBox(text: text, box: CGRect(x: x, y: y, width: 0.2, height: h))
    }
    let boxes = [
      box("right", 0.6, 0.105), box("third", 0.1, 0.5), box("left", 0.1, 0.1),
      box("second", 0.1, 0.2), box("", 0.4, 0.3),
    ]
    #expect(ScreenContext.readingOrder(boxes) == ["left\tright", "second", "third"])
  }

  @Test("The last region returns only on the display and frame it was taken on")
  func regionMemory() {
    var memory = CaptureRegionMemory()
    let frame = CGRect(x: -1920, y: 0, width: 1920, height: 1080)
    let region = CGRect(x: 10, y: 20, width: 300, height: 200)
    #expect(memory.region(displayID: 2, displayFrame: frame) == nil)
    memory.remember(region, displayID: 2, displayFrame: frame)
    #expect(memory.region(displayID: 2, displayFrame: frame) == region)
    #expect(memory.region(displayID: 1, displayFrame: frame) == nil)
    #expect(memory.region(displayID: 2, displayFrame: frame.offsetBy(dx: 1920, dy: 0)) == nil)
    memory.remember(region.insetBy(dx: 5, dy: 5), displayID: 2, displayFrame: frame)
    #expect(memory.region(displayID: 2, displayFrame: frame) == region.insetBy(dx: 5, dy: 5))
  }

  @Test("Recent values keep the newest up to their capacity")
  func recentValues() {
    var recent = RecentValues<Int>(capacity: 3)
    for (index, key) in ["a", "b", "c", "d"].enumerated() { recent.insert(index, for: key) }
    #expect(recent.count == 3 && recent.value(for: "a") == nil && recent.value(for: "d") == 3)
    recent.insert(9, for: "b")
    recent.insert(10, for: "e")
    #expect(recent.value(for: "b") == 9 && recent.value(for: "c") == nil)
  }

  @Test("A reopened image keeps its size and pixels when it fits")
  func reopenFits() throws {
    let screen = CGSize(width: 1512, height: 982)
    let placed = try #require(
      ReopenPlacement.place(
        width: 1200, height: 800, imageScale: 2, screen: screen, displayScale: 2,
        keepsSize: true))
    #expect(placed.compositeWidth == 3024 && placed.compositeHeight == 1964)
    #expect(placed.imagePixels == CGRect(x: 912, y: 582, width: 1200, height: 800))
    #expect(placed.selection == CGRect(x: 456, y: 291, width: 600, height: 400))
    let crop = try #require(
      CaptureCoordinates.pixelRect(
        placed.selection, scale: placed.pixelScale, width: 3024, height: 1964))
    #expect(crop == placed.imagePixels)
    // A whole-display capture fills the screen when it must keep its size.
    let whole = try #require(
      ReopenPlacement.place(
        width: 3024, height: 1964, imageScale: 2, screen: screen, displayScale: 2,
        keepsSize: true))
    #expect(whole.selection == CGRect(origin: .zero, size: screen))
  }

  @Test("A large image is scaled to 85% of the screen with its pixels kept one to one")
  func reopenScalesDown() throws {
    let screen = CGSize(width: 1512, height: 982)
    #expect(
      ReopenPlacement.place(
        width: 5120, height: 2880, imageScale: 2, screen: screen, displayScale: 2,
        keepsSize: true) == nil)
    let placed = try #require(
      ReopenPlacement.place(
        width: 3024, height: 1964, imageScale: 2, screen: screen, displayScale: 2,
        keepsSize: false))
    #expect(placed.imagePixels.size == CGSize(width: 3024, height: 1964))
    #expect(abs(placed.selection.width - 1512 * 0.85) < 1)
    let crop = try #require(
      CaptureCoordinates.pixelRect(
        placed.selection, scale: placed.pixelScale, width: placed.compositeWidth,
        height: placed.compositeHeight))
    #expect(crop == placed.imagePixels)
    // A huge photo is drawn smaller rather than growing the composite past its ceiling.
    let photo = try #require(
      ReopenPlacement.place(
        width: 12_000, height: 9_000, imageScale: 1, screen: screen, displayScale: 2,
        keepsSize: false))
    #expect(CGFloat(photo.compositeWidth) <= ReopenPlacement.maxCompositeLongEdge + 1)
    #expect(photo.imagePixels.width < 12_000)
    #expect(abs(photo.selection.height - 982 * 0.85) < 1)
    #expect(
      ReopenPlacement.place(
        width: 0, height: 10, imageScale: 2, screen: screen, displayScale: 2, keepsSize: false)
        == nil)
  }

  @Test("Option-Shift-arrows move the leading edges inside the display")
  func leadingResize() {
    let model = SelectionModel(size: CGSize(width: 100, height: 80), scale: 2)
    let rect = CGRect(x: 10, y: 10, width: 20, height: 20)
    #expect(
      model.resizedLeading(rect, dx: -1, dy: 0) == CGRect(x: 9, y: 10, width: 21, height: 20))
    #expect(
      model.resizedLeading(rect, dx: 0, dy: 1) == CGRect(x: 10, y: 11, width: 20, height: 19))
    #expect(
      model.resizedLeading(rect, dx: -50, dy: -50) == CGRect(x: 0, y: 0, width: 30, height: 30))
    #expect(
      model.resizedLeading(rect, dx: 40, dy: 0) == CGRect(x: 29.5, y: 10, width: 0.5, height: 20))
  }
}
