import AtdAI
import AtdModel
import Testing

@testable import AtdIntents

struct ClipboardSummaryTests {
  @Test func readsAtMostThreePointsWithoutTheirMarkers() {
    let answer = """
      - First point
      • Second point

      3. Third point
      4、Fourth point
      """
    #expect(
      ClipboardSummary.points(from: answer) == ["First point", "Second point", "Third point"])
  }

  @Test(arguments: ["1. 开会", "1、开会", "(1) 开会", "（1）开会", "* 开会", "— 开会", "开会"])
  func stripsEachKindOfMarker(_ line: String) {
    #expect(ClipboardSummary.point(line) == "开会")
  }

  /// A number that is the point itself stays.
  @Test func keepsANumberThatIsNotAMarker() {
    #expect(ClipboardSummary.point("2026 年的计划") == "2026 年的计划")
  }

  @Test func summarizesWithTheDefaultModel() async throws {
    let generator = FakeGenerator("- A\n- B")
    let points = try await ClipboardSummary.summarize("Some long text", with: generator)
    #expect(points == ["A", "B"])
    #expect(generator.choices == [.appDefault])
    #expect(generator.requests.first?.messages.last?.text.contains("Some long text") == true)
  }

  @Test func anAnswerWithoutPointsIsUnreadable() async {
    await #expect(throws: ModelFailure.unreadable(detail: nil)) {
      try await ClipboardSummary.summarize("Text", with: FakeGenerator("\n  \n"))
    }
  }
}
