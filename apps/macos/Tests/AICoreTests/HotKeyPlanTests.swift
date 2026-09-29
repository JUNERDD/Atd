import Carbon.HIToolbox
import Testing

@testable import AICore

@Suite("Hot key registration diff")
struct HotKeyPlanTests {
  static func combo(_ accelerator: String) -> HotKeyCombination {
    try! Accelerator.parse(accelerator)
  }

  static func request(_ id: String, _ accelerator: String) -> HotKeyRequest {
    HotKeyRequest(id: id, accelerator: accelerator)
  }

  @Test("New entries register; unchanged ones are kept")
  func registerAndKeep() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("panel", "Alt+Space"), Self.request("c1", "Control+Shift+K")],
      registered: ["panel": Self.combo("Alt+Space")], reserved: [])
    #expect(plan.keep == ["panel"])
    #expect(plan.register.map(\.id) == ["c1"])
    #expect(plan.register.map(\.combination) == [Self.combo("Control+Shift+K")])
    #expect(plan.unregister.isEmpty)
    #expect(plan.failures.isEmpty)
  }

  @Test("Removed and changed entries are released before anything registers")
  func releaseFirst() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("c2", "Alt+Space"), Self.request("panel", "Alt+P")],
      registered: ["panel": Self.combo("Alt+Space"), "gone": Self.combo("Alt+G")],
      reserved: [])
    #expect(plan.unregister == ["gone", "panel"])
    #expect(plan.register.map(\.id) == ["c2", "panel"])
  }

  @Test("Spelling variants of one combination keep the registration")
  func sameCombinationSpelledDifferently() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("panel", "Command+Shift+Space")],
      registered: ["panel": Self.combo("CommandOrControl+Shift+Space")], reserved: [])
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
      registered: ["spotlight": Self.combo("Alt+S")], reserved: [reserved])
    #expect(plan.failures["bad"] == .invalidAccelerator(.missingModifier))
    #expect(plan.failures["spotlight"] == .reservedBySystem)
    #expect(plan.failures["second"] == .sameCombination(asId: "first"))
    #expect(plan.failures["first"] == nil)
    #expect(plan.register.map(\.id) == ["first"])
    #expect(plan.register.map(\.combination) == [Self.combo("Alt+K")])
    #expect(plan.unregister == ["spotlight"])
  }

  @Test("A failed entry is attempted again on the next push")
  func retryAfterFailure() {
    let plan = HotKeyPlanner.plan(
      desired: [Self.request("c1", "Alt+K")], registered: [:], reserved: [])
    #expect(plan.register.map(\.id) == ["c1"])
  }
}
