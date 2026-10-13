import Carbon.HIToolbox
import Testing

@testable import AICore

@Suite("Hot key registration diff")
struct HotKeyPlanTests {
  static func combo(_ accelerator: String) -> HotKeyTrigger {
    try! Accelerator.parse(accelerator)
  }

  static func request(_ id: String, _ accelerator: String) -> ShortcutRegistration {
    ShortcutRegistration(id: id, accelerator: accelerator)
  }

  @Test("New entries register; unchanged ones are kept")
  func registerAndKeep() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("panel", "Alt+Space"), Self.request("c1", "Control+Shift+K")],
      registered: ["panel": Self.combo("Alt+Space")], reserved: [], doubleTapAvailable: true)
    #expect(plan.keep == ["panel"])
    #expect(plan.register.map(\.id) == ["c1"])
    #expect(plan.register.map(\.trigger) == [Self.combo("Control+Shift+K")])
    #expect(plan.unregister.isEmpty)
    #expect(plan.failures.isEmpty)
  }

  @Test("Removed and changed entries are released before anything registers")
  func releaseFirst() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("c2", "Alt+Space"), Self.request("panel", "Alt+P")],
      registered: ["panel": Self.combo("Alt+Space"), "gone": Self.combo("Alt+G")],
      reserved: [], doubleTapAvailable: true)
    #expect(plan.unregister == ["gone", "panel"])
    #expect(plan.register.map(\.id) == ["c2", "panel"])
  }

  @Test("Spelling variants of one combination keep the registration")
  func sameCombinationSpelledDifferently() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("panel", "Command+Shift+Space")],
      registered: ["panel": Self.combo("CommandOrControl+Shift+Space")], reserved: [],
      doubleTapAvailable: true)
    #expect(plan.keep == ["panel"])
    #expect(plan.register.isEmpty && plan.unregister.isEmpty)
  }

  @Test("Invalid, reserved and repeated combinations fail without registering")
  func failures() {
    let reserved = ReservedHotKey(
      keyCode: UInt32(kVK_Space), carbonModifiers: UInt32(cmdKey) | 0x80_0000)
    let plan = HotKeyPlanner.plan(
      desired: [
        Self.request("bad", "Shift+A"),
        Self.request("spotlight", "Command+Space"),
        Self.request("first", "Alt+K"),
        Self.request("second", "Alt+K"),
        Self.request("first", "Alt+J"),
      ],
      registered: ["spotlight": Self.combo("Alt+S")], reserved: [reserved], doubleTapAvailable: true
    )
    #expect(plan.failures["bad"] == .invalidAccelerator(.missingModifier))
    #expect(plan.failures["spotlight"] == .reservedBySystem)
    #expect(plan.failures["second"] == .sameCombination(asId: "first"))
    #expect(plan.failures["first"] == nil)
    #expect(plan.register.map(\.id) == ["first"])
    #expect(plan.register.map(\.trigger) == [Self.combo("Alt+K")])
    #expect(plan.unregister == ["spotlight"])
  }

  @Test("A double-tap is planned like a chord and never reserved by the system")
  func doubleTap() {
    let reserved = ReservedHotKey(keyCode: UInt32(kVK_Space), carbonModifiers: UInt32(cmdKey))
    let plan = HotKeyPlanner.plan(
      desired: [
        Self.request("panel", "DoubleTap+Command"),
        Self.request("c1", "DoubleTap+Alt"),
        Self.request("c2", "DoubleTap+Command"),
        Self.request("c3", "Command+Space"),
      ],
      registered: ["c1": Self.combo("DoubleTap+Alt"), "c3": Self.combo("DoubleTap+Shift")],
      reserved: [reserved], doubleTapAvailable: true)
    #expect(plan.keep == ["c1"])
    #expect(plan.register.map(\.trigger) == [.doubleTap(.command)])
    #expect(plan.failures["c2"] == .sameCombination(asId: "panel"))
    #expect(plan.failures["c3"] == .reservedBySystem)
    #expect(plan.unregister == ["c3"])
  }

  @Test("Without Accessibility a double-tap fails and a registered one is released")
  func doubleTapWithoutAccessibility() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("panel", "DoubleTap+Command"), Self.request("c1", "Alt+K")],
      registered: ["panel": Self.combo("DoubleTap+Command")], reserved: [],
      doubleTapAvailable: false)
    #expect(plan.failures == ["panel": .needsAccessibility])
    #expect(HotKeyFailure.needsAccessibility.reason == .unavailable)
    #expect(plan.unregister == ["panel"])
    #expect(plan.register.map(\.id) == ["c1"])
  }

  @Test("A failed entry is attempted again on the next push")
  func retryAfterFailure() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("c1", "Alt+K")], registered: [:], reserved: [],
      doubleTapAvailable: true)
    #expect(plan.register.map(\.id) == ["c1"])
  }
}
