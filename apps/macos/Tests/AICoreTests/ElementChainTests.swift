import CoreGraphics
import Testing

@testable import AICore

@Suite("Element detection policy")
struct ElementChainTests {
  static let window = ElementChain.Window(
    id: 7, pid: 100, frame: CGRect(x: 100, y: 100, width: 800, height: 600))
  static let display = CGRect(x: 0, y: 0, width: 1440, height: 900)
  static let point = CGPoint(x: 300, y: 300)

  static func node(_ role: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double)
    -> ElementChain.Node
  {
    ElementChain.Node(role: role, frame: CGRect(x: x, y: y, width: w, height: h))
  }

  static func windowNode(_ frame: CGRect = window.frame) -> ElementChain.Node {
    ElementChain.Node(role: "AXWindow", frame: frame)
  }

  static func targets(
    _ chain: [ElementChain.Node]?, window: ElementChain.Window = window,
    displays: [CGRect] = [display], at point: CGPoint = point
  ) -> [CGRect] {
    ElementChain.targets(at: point, window: window, displays: displays, chain: chain)
  }

  @Test("Orders the chain smallest first and ends with the window")
  func ordersChain() {
    let result = Self.targets([
      Self.node("AXButton", 280, 280, 60, 30),
      Self.node("AXToolbar", 100, 260, 800, 60),
      Self.windowNode(),
    ])
    #expect(
      result == [
        CGRect(x: 280, y: 280, width: 60, height: 30),
        CGRect(x: 100, y: 260, width: 800, height: 60),
        Self.window.frame,
      ])
  }

  @Test("Collapses stacked groups that report the same frame")
  func dedupesStackedGroups() {
    let group = Self.node("AXGroup", 120, 120, 400, 300)
    let nearly = Self.node("AXGroup", 120.5, 119.6, 400.4, 300.5)
    let result = Self.targets([
      group, nearly, group, Self.node("AXScrollArea", 100, 100, 800.5, 600), Self.windowNode(),
    ])
    #expect(result == [CGRect(x: 120, y: 120, width: 400, height: 300), Self.window.frame])
  }

  @Test("Drops a candidate that only approximates the window")
  func dropsWindowSizedGroups() {
    let result = Self.targets([
      Self.node("AXGroup", 101, 100, 799, 600),
      Self.windowNode(),
    ])
    #expect(result == [Self.window.frame])
  }

  @Test("Clips elements to the window and the display")
  func clipsToWindowAndDisplay() {
    let edge = ElementChain.Window(
      id: 8, pid: 100, frame: CGRect(x: 1000, y: 100, width: 800, height: 600))
    let result = Self.targets(
      [
        Self.node("AXGroup", 1100, 150, 600, 200),
        ElementChain.Node(role: "AXWindow", frame: edge.frame),
      ], window: edge, at: CGPoint(x: 1200, y: 200))
    // The display ends at x = 1440: the group and the window lose what is off-screen.
    #expect(
      result == [
        CGRect(x: 1100, y: 150, width: 340, height: 200),
        CGRect(x: 1000, y: 100, width: 440, height: 600),
      ])
  }

  @Test("Clips an element that overflows its window")
  func clipsOverflow() {
    let result = Self.targets([
      Self.node("AXGroup", 50, 150, 300, 300),
      Self.windowNode(),
    ])
    #expect(result == [CGRect(x: 100, y: 150, width: 250, height: 300), Self.window.frame])
  }

  @Test("Skips tiny and non-finite frames")
  func skipsUnusableFrames() {
    let result = Self.targets([
      Self.node("AXButton", 295, 295, 4, 40),
      Self.node("AXButton", .nan, 295, 40, 40),
      Self.node("AXButton", 295, 295, Double.infinity, 40),
      Self.node("AXButton", 295, 295, 0, 0),
      Self.node("AXGroup", 250, 250, 100, 100),
      Self.windowNode(),
    ])
    #expect(result == [CGRect(x: 250, y: 250, width: 100, height: 100), Self.window.frame])
  }

  @Test("Skips frames that do not contain the point")
  func skipsFramesAwayFromPoint() {
    let result = Self.targets([Self.node("AXGroup", 500, 500, 100, 100), Self.windowNode()])
    #expect(result == [Self.window.frame])
  }

  @Test("Denies the application, the menu bar and unknown roles")
  func deniesRoles() {
    let result = Self.targets([
      Self.node("AXUnknown", 250, 250, 100, 100),
      Self.node("AXMenuBar", 200, 200, 300, 300),
      Self.node("AXApplication", 150, 150, 500, 500),
      Self.node("AXButton", 260, 260, 50, 50),
      Self.windowNode(),
    ])
    #expect(result == [CGRect(x: 260, y: 260, width: 50, height: 50), Self.window.frame])
  }

  @Test("Orders a scroll view's oversized content after the view")
  func ordersByArea() {
    let result = Self.targets([
      Self.node("AXRow", 110, 280, 780, 40),
      Self.node("AXGroup", 100, 200, 800, 2000),
      Self.node("AXScrollArea", 100, 200, 800, 400),
      Self.windowNode(),
    ])
    #expect(
      result == [
        CGRect(x: 110, y: 280, width: 780, height: 40),
        CGRect(x: 100, y: 200, width: 800, height: 400),
        CGRect(x: 100, y: 200, width: 800, height: 500),
        Self.window.frame,
      ])
  }

  @Test("Discards a chain whose window does not match the snapshot")
  func windowMismatch() {
    let other = CGRect(x: 100, y: 100, width: 700, height: 600)
    #expect(
      Self.targets([Self.node("AXGroup", 250, 250, 100, 100), Self.windowNode(other)])
        == [Self.window.frame])
    #expect(
      Self.targets([Self.windowNode(CGRect(x: 102, y: 98, width: 802, height: 598))]).count == 1)
  }

  @Test("Discards a chain that never reaches a window")
  func chainWithoutWindow() {
    #expect(
      Self.targets([Self.node("AXGroup", 250, 250, 100, 100)]) == [Self.window.frame])
  }

  @Test("Accepts a sheet that is the window and keeps a sheet inside it")
  func sheets() {
    let sheet = CGRect(x: 200, y: 100, width: 400, height: 250)
    let result = Self.targets([
      Self.node("AXButton", 250, 250, 60, 30),
      ElementChain.Node(role: "AXSheet", frame: sheet),
      Self.windowNode(),
    ])
    #expect(result.last == Self.window.frame)
    #expect(result.contains(sheet))
    let ownWindow = ElementChain.Window(id: 9, pid: 100, frame: sheet)
    #expect(
      Self.targets(
        [
          Self.node("AXButton", 250, 250, 60, 30), ElementChain.Node(role: "AXSheet", frame: sheet),
        ],
        window: ownWindow, at: CGPoint(x: 270, y: 260))
        == [CGRect(x: 250, y: 250, width: 60, height: 30), sheet])
  }

  @Test("Offers only the window when Accessibility is unavailable")
  func untrustedFallback() {
    #expect(Self.targets(nil) == [Self.window.frame])
    #expect(Self.targets([]) == [Self.window.frame])
  }

  @Test("Offers nothing when the window is unusable or off every display's point")
  func unusableWindow() {
    let tiny = ElementChain.Window(
      id: 1, pid: 1, frame: CGRect(x: 290, y: 290, width: 3, height: 3))
    #expect(Self.targets(nil, window: tiny, at: CGPoint(x: 291, y: 291)).isEmpty)
    let offscreen = ElementChain.Window(
      id: 2, pid: 1, frame: CGRect(x: 2000, y: 0, width: 300, height: 300))
    #expect(Self.targets(nil, window: offscreen, at: CGPoint(x: 2100, y: 100)).count == 1)
  }

  @Test("No window under the point leaves nothing to offer")
  func noWindow() {
    let windows = [Self.window]
    #expect(ElementChain.topmostWindow(at: CGPoint(x: 50, y: 50), in: windows) == nil)
    #expect(ElementChain.topmostWindow(at: Self.point, in: []) == nil)
  }

  @Test("The frontmost window containing the point wins, skipping unusable ones")
  func topmost() {
    let sliver = ElementChain.Window(
      id: 1, pid: 1, frame: CGRect(x: 0, y: 0, width: 2000, height: 3))
    let nan = ElementChain.Window(
      id: 2, pid: 2, frame: CGRect(x: Double.nan, y: 0, width: 2000, height: 2000))
    let front = ElementChain.Window(
      id: 3, pid: 3, frame: CGRect(x: 250, y: 250, width: 100, height: 100))
    let windows = [sliver, nan, front, Self.window]
    #expect(ElementChain.topmostWindow(at: CGPoint(x: 1, y: 1), in: windows) == nil)
    #expect(ElementChain.topmostWindow(at: Self.point, in: windows) == front)
    #expect(ElementChain.topmostWindow(at: CGPoint(x: 500, y: 500), in: windows) == Self.window)
    // Adjacent windows do not share an edge pixel.
    #expect(ElementChain.topmostWindow(at: CGPoint(x: 350, y: 300), in: windows) == Self.window)
  }

  @Test("Works on displays with negative origins")
  func negativeOrigin() {
    let left = CGRect(x: -1920, y: -100, width: 1920, height: 1080)
    let main = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let spanning = ElementChain.Window(
      id: 5, pid: 5, frame: CGRect(x: -400, y: 0, width: 800, height: 500))
    let point = CGPoint(x: -200, y: 100)
    let result = Self.targets(
      [
        Self.node("AXGroup", -380, 20, 300, 200),
        ElementChain.Node(role: "AXWindow", frame: spanning.frame),
      ], window: spanning, displays: [main, left], at: point)
    #expect(
      result == [
        CGRect(x: -380, y: 20, width: 300, height: 200),
        CGRect(x: -400, y: 0, width: 400, height: 500),
      ])
    // On the primary display the same window is clipped the other way.
    let right = Self.targets(
      nil, window: spanning, displays: [main, left], at: CGPoint(x: 100, y: 100))
    #expect(right == [CGRect(x: 0, y: 0, width: 400, height: 500)])
  }

  @Test("Finds the elements that offered a picked candidate, never the window")
  func elementIndices() {
    let chain = [
      Self.node("AXStaticText", 281, 281, 58, 28),
      Self.node("AXButton", 280, 280, 60, 30),
      Self.node("AXGroup", 280, 280, 60, 30),
      Self.node("AXToolbar", 100, 260, 800, 60),
      Self.windowNode(),
    ]
    func indices(_ frame: CGRect, chain: [ElementChain.Node] = chain) -> [Int] {
      ElementChain.elementIndices(
        offering: frame, at: Self.point, window: Self.window, displays: [Self.display],
        chain: chain)
    }
    #expect(indices(CGRect(x: 280, y: 280, width: 60, height: 30)) == [0, 1, 2])
    #expect(indices(CGRect(x: 100, y: 260, width: 800, height: 60)) == [3])
    #expect(indices(Self.window.frame).isEmpty)
    #expect(indices(CGRect(x: 0, y: 0, width: 50, height: 50)).isEmpty)
    // A chain that never reaches this window describes nothing.
    #expect(
      indices(CGRect(x: 280, y: 280, width: 60, height: 30), chain: Array(chain.prefix(3))).isEmpty)
  }
}
