import Testing

@testable import AICore

@Suite("Answer card overflow")
struct AnswerOverflowTests {
  @Test("An answer that fits overflows neither edge")
  func fits() {
    #expect(AnswerOverflow(offset: 0, content: 120, container: 300) == AnswerOverflow())
    #expect(AnswerOverflow(offset: 0, content: 300, container: 300) == AnswerOverflow())
  }

  @Test("A long answer overflows below at the top, both ways in the middle, above at the end")
  func scrolls() {
    #expect(
      AnswerOverflow(offset: 0, content: 1000, container: 300)
        == AnswerOverflow(top: false, bottom: true))
    #expect(
      AnswerOverflow(offset: 350, content: 1000, container: 300)
        == AnswerOverflow(top: true, bottom: true))
    #expect(
      AnswerOverflow(offset: 700, content: 1000, container: 300)
        == AnswerOverflow(top: true, bottom: false))
  }

  @Test("Within half a point of an edge the answer reaches it; insets move the edges")
  func tolerance() {
    #expect(AnswerOverflow(offset: 0.4, content: 1000, container: 300).top == false)
    #expect(AnswerOverflow(offset: 699.6, content: 1000, container: 300).bottom == false)
    #expect(AnswerOverflow(offset: -8, content: 1000, container: 300, insetTop: 8).top == false)
    #expect(AnswerOverflow(offset: 700, content: 1000, container: 300, insetBottom: 8).bottom)
  }
}
