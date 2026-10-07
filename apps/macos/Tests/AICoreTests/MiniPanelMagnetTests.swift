import CoreGraphics
import Testing

@testable import AICore

@Suite("Mini panel drop magnet")
struct MiniPanelMagnetTests {
  /// The right-edge invite and drop card of a 1440 × 875 work area, centered at y 525.
  static let invite = ScreenRect(x: 1388, y: 477, width: 44, height: 96)
  static let target = ScreenRect(x: 1248, y: 469, width: 184, height: 112)

  static func update(_ magnet: inout MiniPanelMagnet, x: Double, y: Double, at now: Double)
    -> Bool
  {
    magnet.update(CGPoint(x: x, y: y), invite: invite, target: target, at: now)
  }

  @Test("The card takes the item within 16 pt of the invite")
  func enters() {
    var magnet = MiniPanelMagnet()
    #expect(!Self.update(&magnet, x: 1388 - 17, y: 525, at: 0))
    #expect(!magnet.isTargeted)
    #expect(Self.update(&magnet, x: 1388 - 15, y: 525, at: 0.016))
    #expect(magnet.isTargeted)
  }

  @Test("A pointer resting on the card keeps it for two seconds and more")
  func restingIsStable() {
    var magnet = MiniPanelMagnet()
    _ = Self.update(&magnet, x: 1400, y: 525, at: 0)
    var changes = 0
    var shown = true
    for frame in 1...180 {
      // At rest on the card, then wavering just inside its 24 pt hold zone.
      let x = frame < 120 ? 1300.0 : 1248 - 23 + Double(frame % 3)
      let now = Double(frame) / 60
      let targeted = Self.update(&magnet, x: x, y: 525, at: now)
      if targeted != shown { changes += 1 }
      shown = targeted
    }
    #expect(changes == 0)
    #expect(magnet.isTargeted)
    #expect(!magnet.isTiming)
  }

  @Test("The card lets go only after 120 ms outside its 24 pt hold zone")
  func leavesAfterDelay() {
    var magnet = MiniPanelMagnet()
    _ = Self.update(&magnet, x: 1400, y: 525, at: 0)
    #expect(Self.update(&magnet, x: 1248 - 25, y: 525, at: 1))
    #expect(magnet.isTiming)
    #expect(Self.update(&magnet, x: 1248 - 40, y: 525, at: 1.11))
    #expect(!Self.update(&magnet, x: 1248 - 40, y: 525, at: 1.12))
    #expect(!magnet.isTargeted)
    #expect(!magnet.isTiming)
  }

  @Test("Coming back inside the hold zone starts the departure over")
  func returnResets() {
    var magnet = MiniPanelMagnet()
    _ = Self.update(&magnet, x: 1400, y: 525, at: 0)
    _ = Self.update(&magnet, x: 1100, y: 525, at: 1)
    #expect(Self.update(&magnet, x: 1240, y: 525, at: 1.1))
    #expect(Self.update(&magnet, x: 1100, y: 525, at: 1.15))
    #expect(Self.update(&magnet, x: 1100, y: 525, at: 1.26))
    #expect(!Self.update(&magnet, x: 1100, y: 525, at: 1.28))
  }

  @Test("Once let go, the item must come within 16 pt of the invite again")
  func reentersByTheInvite() {
    var magnet = MiniPanelMagnet()
    _ = Self.update(&magnet, x: 1400, y: 525, at: 0)
    _ = Self.update(&magnet, x: 1100, y: 525, at: 1)
    _ = Self.update(&magnet, x: 1100, y: 525, at: 1.2)
    // Inside the card's hold zone, but not near the invite: the card stays down.
    #expect(!Self.update(&magnet, x: 1250, y: 525, at: 1.3))
    #expect(Self.update(&magnet, x: 1380, y: 525, at: 1.4))
    magnet.reset()
    #expect(!magnet.isTargeted)
  }

  @Test("Drops land in the magnet's reach: the enter zone, then the hold zone")
  func dropZone() {
    #expect(
      MiniPanelMagnet.dropZone(invite: Self.invite, target: Self.target, targeted: false)
        == ScreenRect(x: 1372, y: 461, width: 76, height: 128))
    #expect(
      MiniPanelMagnet.dropZone(invite: Self.invite, target: Self.target, targeted: true)
        == ScreenRect(x: 1224, y: 445, width: 232, height: 160))
  }
}
