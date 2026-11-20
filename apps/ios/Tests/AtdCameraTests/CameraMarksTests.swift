import AtdAI
import AtdModel
import CoreGraphics
import Foundation
import Testing

@Suite struct CameraMarksTests {
  private func fields(_ json: String) throws -> CameraMarkFields {
    try JSONDecoder().decode(CameraMarkFields.self, from: Data(json.utf8))
  }

  private let receipt = CardResult.expense(
    ExpenseDraft(
      amount: 199.9, currency: "CNY", merchant: "便利店", category: .shopping, date: .now,
      book: "日常"))

  @Test func expenseMarksFollowMerchantTimeTotalAndShareIdenticalLines() throws {
    // Date and total were read from the same line: one box, one number.
    let marks = CameraMarks.marks(
      try fields(
        #"{"marks":[{"field":"total","lines":[6]},{"field":"merchant","lines":[1]},{"field":"time","lines":[6]}]}"#
      ), for: receipt, lineCount: 8)
    #expect(
      marks == [
        CameraMark(number: 1, fields: [.merchant], lines: [1]),
        CameraMark(number: 2, fields: [.time, .total], lines: [6]),
      ])
  }

  @Test func missingPartsAndUnknownLinesGetNoNumber() throws {
    var draft = EventDraft(title: "发布会", start: .now, isAllDay: true, alert: .off)
    draft.location = nil
    let marks = CameraMarks.marks(
      try fields(
        #"{"marks":[{"field":"time","lines":[2]},{"field":"place","lines":[3]},{"field":"date","lines":[40,"4"]}]}"#
      ), for: .event(draft), lineCount: 5)
    // All day: no time; no location: no place; the date keeps its existing line.
    #expect(marks == [CameraMark(number: 1, fields: [.date], lines: [4])])
  }

  @Test func whiteboardSectionsAreMarkedInOrderAndBadMarksSkipped() throws {
    let notes = NotesCard(
      title: "周会",
      sections: [
        NotesCard.Section(heading: "进度", bullets: ["上线"]),
        NotesCard.Section(heading: "风险", bullets: ["人手"]),
      ], todos: [])
    let marks = CameraMarks.marks(
      try fields(
        #"{"marks":[{"section":"2","lines":[5,4]},"oops",{"section":1,"lines":[1,2]}]}"#),
      for: .notes(notes), lineCount: 6)
    #expect(marks.map(\.fields) == [[.section(1)], [.section(2)]])
    #expect(marks.map(\.lines) == [[1, 2], [4, 5]])
  }

  @Test func onlyCardsThatComeFromAPhotoAskForMarks() {
    #expect(CameraMarks.rule(for: .expense)?.contains("\"marks\"") == true)
    #expect(CameraMarks.rule(for: .notes) != nil)
    #expect(CameraMarks.rule(for: .text) == nil)
    #expect(CameraMarks.marks(nil, for: receipt, lineCount: 3).isEmpty)
  }
}

@Suite struct CameraLayoutTests {
  @Test func aPhotoFitsCenteredWithItsAspect() {
    let fitted = CameraLayout.aspectFit(
      CGSize(width: 3000, height: 4000), in: CGRect(x: 0, y: 0, width: 400, height: 400))
    #expect(fitted == CGRect(x: 50, y: 0, width: 300, height: 400))
  }

  @Test func labelsGoBelowTheirBoxAndStepDownPastEachOther() {
    let bounds = CGRect(x: 0, y: 0, width: 300, height: 500)
    let size = CGSize(width: 120, height: 20)
    let frames = CameraLayout.place(
      [
        CameraLayout.Label(anchor: CGRect(x: 10, y: 10, width: 100, height: 20), size: size),
        CameraLayout.Label(anchor: CGRect(x: 30, y: 12, width: 100, height: 20), size: size),
      ], in: bounds)
    #expect(frames[0].minY == 34)
    #expect(frames[1].minY == frames[0].maxY + 4)
  }

  @Test func aTagGoesBesideItsBoxWhenThereIsRoom() {
    let frames = CameraLayout.place(
      [
        CameraLayout.Label(
          anchor: CGRect(x: 10, y: 10, width: 100, height: 20), size: CGSize(width: 60, height: 20))
      ], in: CGRect(x: 0, y: 0, width: 300, height: 200), besideFirst: true)
    #expect(frames == [CGRect(x: 114, y: 10, width: 60, height: 20)])
  }

  @Test func aLabelKeepsOffThePhotosTextWhereItCan() {
    // A full-width line with another line right under it: the tag goes above, not over it.
    let anchor = CGRect(x: 10, y: 50, width: 280, height: 20)
    let next = CGRect(x: 10, y: 74, width: 200, height: 20)
    let label = CameraLayout.Label(anchor: anchor, size: CGSize(width: 100, height: 20))
    let bounds = CGRect(x: 0, y: 0, width: 300, height: 200)
    let frames = CameraLayout.place(
      [label], in: bounds, avoiding: [anchor, next], besideFirst: true)
    #expect(frames == [CGRect(x: 10, y: 26, width: 100, height: 20)])
    // With text above as well, it falls back to going under its box.
    let above = CGRect(x: 10, y: 26, width: 200, height: 20)
    let crowded = CameraLayout.place(
      [label], in: bounds, avoiding: [above, anchor, next], besideFirst: true)
    #expect(crowded == [CGRect(x: 10, y: 74, width: 100, height: 20)])
  }

  @Test func aLabelNearTheBottomGoesAboveItsBoxAndStaysInside() {
    let bounds = CGRect(x: 0, y: 0, width: 200, height: 300)
    let frames = CameraLayout.place(
      [
        CameraLayout.Label(
          anchor: CGRect(x: 150, y: 270, width: 40, height: 20),
          size: CGSize(width: 120, height: 20))
      ], in: bounds)
    #expect(frames[0].maxY <= 270)
    #expect(frames[0].maxX <= 200)
  }
}
