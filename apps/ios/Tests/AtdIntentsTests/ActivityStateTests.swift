import AtdModel
import Foundation
import Testing

@testable import AtdIntents

struct ActivityStateTests {
  private typealias State = BriefingActivityAttributes.ContentState

  @Test func keepsThreeLinesCutToTheirLimit() {
    let long = String(repeating: "很", count: 200)
    let state = State(phase: .done, lines: ["One.", long, "Three.", "Four."])
    #expect(state.lines.count == State.lineLimit)
    #expect(state.lines[0] == "One.")
    #expect(state.lines[1].count == State.characterLimit)
    #expect(state.lines[1].hasSuffix("…"))
  }

  /// ActivityKit drops an update whose attributes and state pass 4 KB; the worst case, with a
  /// long name and every line at its limit in three-byte characters, stays below it.
  @Test func worstCaseStaysBelowActivityKitsLimit() throws {
    let worst = String(repeating: "很", count: 500)
    var command = personCommand(worst, input: .none)
    command.id = UUID().uuidString
    let attributes = BriefingActivityAttributes(command: command, day: .now)
    let state = State(
      phase: .failed, lines: Array(repeating: worst, count: 8), message: worst, canRetry: true)
    let encoder = JSONEncoder()
    let size = try encoder.encode(attributes).count + encoder.encode(state).count
    #expect(size < 4_096)
  }
}
