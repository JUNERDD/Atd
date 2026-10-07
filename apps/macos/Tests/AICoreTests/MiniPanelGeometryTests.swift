import CoreGraphics
import Testing

@testable import AICore

@Suite("Mini panel geometry")
struct MiniPanelGeometryTests {
  /// A 1440 × 900 display with a 25 pt menu bar and no Dock in the way.
  static let display = ScreenRect(x: 0, y: 0, width: 1440, height: 900)
  static let workArea = ScreenRect(x: 0, y: 0, width: 1440, height: 875)

  static func layout(
    _ edge: MiniPanelEdge = .right, position: Double = 0.4, commands: Int = 3,
    workArea: ScreenRect = workArea, display: ScreenRect = display
  ) -> MiniPanelLayout {
    MiniPanelLayout(
      placement: MiniPanelPlacement(edge: edge, position: position), workArea: workArea,
      displayFrame: display, commands: commands, flyoutWidth: 200)
  }

  @Test("A placement keeps its position between 0 and 1")
  func placement() {
    #expect(MiniPanelPlacement(edge: .left, position: -2).position == 0)
    #expect(MiniPanelPlacement(edge: .left, position: 7).position == 1)
    #expect(MiniPanelPlacement(edge: .left, position: .nan).position == 0.4)
    #expect(MiniPanelEdge.left.opposite == .right)
    #expect(MiniPanelPlacement.standard == MiniPanelPlacement(edge: .right, position: 0.4))
  }

  @Test("The capsule holds the mark, the hairline and three or four buttons")
  func capsuleHeight() {
    #expect(MiniPanelMetrics.capsuleHeight(hasCommands: false) == 157)
    #expect(MiniPanelMetrics.capsuleHeight(hasCommands: true) == 193)
    #expect(MiniPanelMetrics.flyoutHeight(rows: 1) == 40)
    #expect(MiniPanelMetrics.flyoutHeight(rows: 20) == 236)
    #expect(MiniPanelMetrics.flyoutWidth(textWidth: 10) == 180)
    #expect(MiniPanelMetrics.flyoutWidth(textWidth: 200) == 228)
    #expect(MiniPanelMetrics.flyoutWidth(textWidth: 900) == 280)
  }

  @Test("On the right edge the pill rests 4 pt and the capsule 8 pt inside, centered on the pill")
  func rightEdge() {
    let layout = Self.layout()
    let center = 875 - 0.4 * 875
    #expect(layout.pill == ScreenRect(x: 1430, y: center - 22, width: 6, height: 44))
    #expect(layout.capsule == ScreenRect(x: 1388, y: center - 96.5, width: 44, height: 193))
    #expect(layout.invite == ScreenRect(x: 1388, y: center - 48, width: 44, height: 96))
    #expect(layout.target == ScreenRect(x: 1248, y: center - 56, width: 184, height: 112))
    #expect(layout.hotZone == ScreenRect(x: 1420, y: center - 38, width: 20, height: 76))
  }

  @Test("On the left edge every shape mirrors toward the interior")
  func leftEdge() {
    let layout = Self.layout(.left)
    #expect(layout.pill.x == 4)
    #expect(layout.capsule.x == 8)
    #expect(layout.invite.x == 8)
    #expect(layout.target.x == 8)
    #expect(layout.hotZone.x == 0)
    #expect(layout.flyout?.x == 60.0)
    #expect(Self.layout().flyout?.maxX == 1380.0)
  }

  @Test("Buttons stack from the top: the mark, the hairline 4 pt below it, then 4 pt gaps")
  func buttons() {
    let layout = Self.layout()
    let capsule = layout.capsule
    #expect(layout.buttons.count == 5)
    #expect(layout.buttons[0].maxY == capsule.maxY - 6)
    #expect(layout.hairline.maxY == layout.buttons[0].y - 4)
    #expect(layout.buttons[1].maxY == layout.hairline.y - 4)
    #expect(layout.hairline.width == 28)
    #expect(layout.hairline.x == capsule.x + 8)
    for (upper, lower) in zip(layout.buttons.dropFirst(), layout.buttons.dropFirst(2)) {
      #expect(upper.y - lower.maxY == 4)
    }
    #expect(layout.buttons.last?.y == capsule.y + 6)
    #expect(layout.buttons.allSatisfy { $0.x == capsule.x + 6 && $0.width == 32 })
    #expect(Self.layout(commands: 0).buttons.count == 4)
    #expect(Self.layout(commands: 0).flyout == nil)
  }

  @Test("The card's last row sits level with the Commands button and the card rises from it")
  func flyoutBesideCommands() throws {
    let layout = Self.layout(commands: 3)
    let flyout = try #require(layout.flyout)
    let commands = layout.buttons[4]
    #expect(flyout.y + 6 + 14 == commands.midY)
    #expect(flyout.height == 6 * 2 + 3 * 28)
    #expect(flyout.width == 200)
    #expect(Self.layout(commands: 30).flyout?.height == 236)
  }

  @Test("Near the top or bottom the pill keeps 8 pt and the larger shapes shift inward")
  func clamping() {
    for position in [0.0, 1.0] {
      let layout = Self.layout(position: position, commands: 12)
      let inner = Self.workArea.outset(by: -8)
      for shape in [layout.pill, layout.capsule, layout.invite, layout.target, layout.flyout!] {
        #expect(shape.y >= inner.y && shape.maxY <= inner.maxY, "position \(position)")
      }
    }
    #expect(Self.layout(position: 0).pill.maxY == 875 - 8)
    #expect(Self.layout(position: 1).pill.y == 8)
  }

  @Test("Placement and pill center round-trip inside the margins")
  func positionRoundTrip() {
    let area = Self.workArea
    for position in [0.05, 0.4, 0.73, 0.95] {
      let y = MiniPanelLayout.pillCenterY(position: position, in: area)
      #expect(abs(MiniPanelLayout.position(ofPillCenterY: y, in: area) - position) < 1e-9)
    }
    #expect(MiniPanelLayout.pillCenterY(position: 0, in: area) == 875 - 30)
    #expect(MiniPanelLayout.position(ofPillCenterY: 5000, in: area) == 30.0 / 875)
  }

  @Test("Displays left of and below the primary one work like any other")
  func negativeOrigins() {
    let display = ScreenRect(x: -1920, y: -1080, width: 1920, height: 1080)
    let area = ScreenRect(x: -1920, y: -1080, width: 1920, height: 1055)
    let layout = Self.layout(.left, position: 0.5, workArea: area, display: display)
    #expect(layout.pill.x == -1916)
    #expect(layout.pill.midY == -1080 + 1055.0 / 2)
    #expect(layout.canvas.y >= display.y && layout.canvas.maxY <= display.maxY)
  }

  @Test("Every state's shapes fit in the canvas, which stays on its display vertically")
  func canvasHoldsEveryShape() {
    let displays = [
      (Self.display, Self.workArea),
      (
        ScreenRect(x: -1280, y: 900, width: 1280, height: 720),
        ScreenRect(x: -1280, y: 900, width: 1280, height: 695)
      ),
    ]
    for (display, area) in displays {
      for edge in MiniPanelEdge.allCases {
        for position in stride(from: 0.0, through: 1.0, by: 0.05) {
          for commands in [0, 1, 4, 8, 40] {
            let layout = Self.layout(
              edge, position: position, commands: commands, workArea: area, display: display)
            let canvas = layout.canvas
            var shapes =
              [layout.pill, layout.capsule, layout.invite, layout.target]
              + [layout.flyout].compactMap { $0 }
            // The widest hover labels, beside the capsule and beside the card, and the drop
            // zones of a drag session.
            shapes.append(
              layout.hoverLabel(beside: layout.capsule, centerY: layout.capsule.midY, width: 999))
            if let card = layout.flyout {
              shapes.append(layout.hoverLabel(beside: card, centerY: card.y + 20, width: 999))
            }
            // A drop zone may reach past the display's edge, where no release can land; the
            // part on the display must be in the canvas.
            for targeted in [false, true] {
              let zone = MiniPanelMagnet.dropZone(
                invite: layout.invite, target: layout.target, targeted: targeted)
              let bottom = max(zone.y, display.y)
              let top = min(zone.maxY, display.maxY)
              shapes.append(
                ScreenRect(x: zone.x, y: bottom, width: zone.width, height: top - bottom))
            }
            shapes.append(layout.swell)
            // The glass container covers every shape, inside the canvas.
            let region = layout.glassRegion
            for (shape, bounds) in shapes.map({ ($0, canvas) }) + shapes.map({ ($0, region) })
              + [(region, canvas)]
            {
              #expect(
                shape.x >= bounds.x && shape.maxX <= bounds.maxX && shape.y >= bounds.y
                  && shape.maxY <= bounds.maxY, "\(edge) \(position) \(commands)")
            }
            #expect(layout.canvas.y >= display.y && layout.canvas.maxY <= display.maxY)
            #expect(layout.canvas.size == MiniPanelMetrics.canvasSize)
            #expect(abs(layout.canvas.midX - layout.capsule.midX) < 1e-9)
          }
        }
      }
    }
  }

  @Test("Each shape is a per-axis target: thickness across the edge, length along it")
  func shapeTargets() {
    for edge in MiniPanelEdge.allCases {
      let layout = Self.layout(edge, position: 0.4, commands: 2)
      let outer = { (rect: ScreenRect) in edge == .right ? 1440 - rect.maxX : rect.x }
      #expect(layout.rect(of: .pill) == layout.pill)
      #expect(layout.rect(of: .swell) == layout.swell)
      #expect(layout.rect(of: .capsule) == layout.capsule)
      #expect(layout.rect(of: .invite) == layout.invite)
      #expect(layout.rect(of: .target) == layout.target)
      // Thickness across the edge, anchored on the column's edge side.
      #expect(layout.pill.width == 6 && outer(layout.pill) == 4)
      // The swell: 6 → 10 pt thick and 8 pt longer, against the same edge.
      #expect(layout.swell.width == 10 && outer(layout.swell) == 4)
      #expect(layout.swell.height == layout.pill.height + 8)
      #expect(layout.capsule.width == 44 && outer(layout.capsule) == 8)
      #expect(layout.invite.width == 44 && outer(layout.invite) == 8)
      #expect(layout.target.width == 184 && outer(layout.target) == 8)
      // Length along the edge, all centered on the pill away from the work area's ends.
      for shape in MiniPanelShape.allCases {
        #expect(abs(layout.rect(of: shape).midY - layout.pill.midY) < 1e-9, "\(shape)")
      }
      #expect(layout.capsule.height == 193 && layout.invite.height == 96)
      #expect(layout.target.height == 112)
    }
    let layout = Self.layout()
    #expect(layout.cornerRadius(of: .pill) == 3)
    #expect(layout.cornerRadius(of: .swell) == 5)
    #expect(layout.cornerRadius(of: .capsule) == 22)
    #expect(layout.cornerRadius(of: .invite) == 22)
    #expect(layout.cornerRadius(of: .target) == 18)
  }

  @Test("The canvas moves with the placement only, never with the command list")
  func canvasIgnoresCommands() {
    for position in [0.0, 0.5, 1.0] {
      #expect(
        Self.layout(position: position, commands: 0).canvas
          == Self.layout(position: position, commands: 9).canvas)
    }
  }

  @Test("The hot zone and the collapse margin")
  func pointerRegions() throws {
    let layout = Self.layout()
    let pill = layout.pill
    #expect(layout.isInHotZone(CGPoint(x: 1421, y: pill.maxY + 15)))
    #expect(!layout.isInHotZone(CGPoint(x: 1419, y: pill.midY)))
    #expect(!layout.isInHotZone(CGPoint(x: 1435, y: pill.maxY + 17)))
    let capsule = layout.capsule
    #expect(layout.keepsOpen(CGPoint(x: capsule.x - 11, y: capsule.midY), flyoutOpen: false))
    #expect(!layout.keepsOpen(CGPoint(x: capsule.x - 13, y: capsule.midY), flyoutOpen: false))
    let flyout = try #require(layout.flyout)
    let onCard = CGPoint(x: flyout.x + 4, y: flyout.midY)
    #expect(layout.keepsOpen(onCard, flyoutOpen: true))
    #expect(!layout.keepsOpen(onCard, flyoutOpen: false))
  }

  @Test("Buttons and rows under the pointer, rows following the card's scroll")
  func hitTesting() throws {
    let layout = Self.layout(commands: 12)
    #expect(layout.button(at: CGPoint(x: layout.buttons[2].midX, y: layout.buttons[2].midY)) == 2)
    #expect(layout.button(at: CGPoint(x: layout.hairline.midX, y: layout.hairline.midY)) == nil)
    let flyout = try #require(layout.flyout)
    let firstRow = CGPoint(x: flyout.midX, y: flyout.maxY - 6 - 1)
    #expect(layout.row(at: firstRow, scroll: 0, count: 12) == 0)
    #expect(layout.row(at: firstRow, scroll: 28, count: 12) == 1)
    let lastRow = CGPoint(x: flyout.midX, y: flyout.y + 6 + 1)
    #expect(layout.row(at: lastRow, scroll: 0, count: 12) == 7)
    #expect(layout.row(at: lastRow, scroll: 4 * 28, count: 12) == 11)
    #expect(
      layout.row(at: CGPoint(x: flyout.midX, y: flyout.maxY - 2), scroll: 0, count: 12) == nil)
    // Every card ends level with the Commands button, so the last visible row sits there.
    #expect(Self.layout(commands: 2).row(at: lastRow, scroll: 0, count: 2) == 1)
  }

  @Test("The pointer stays watched near the drawn shapes and the hot zone")
  func nearness() {
    let layout = Self.layout()
    #expect(layout.isNear(CGPoint(x: 1380, y: layout.pill.midY), shapes: []))
    let besideCard = CGPoint(x: 1210, y: layout.target.midY)
    #expect(layout.isNear(besideCard, shapes: [layout.target]))
    #expect(!layout.isNear(besideCard, shapes: []))
    #expect(!layout.isNear(CGPoint(x: 600, y: 400), shapes: [layout.capsule]))
  }
}
