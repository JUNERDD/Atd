import AtdAI
import AtdModel
import Foundation
import Testing

@testable import AtdAppUI

private func command(_ id: String) throws -> Command {
  try #require(BuiltinCommands.all().first { $0.id == id })
}

@MainActor @Suite struct CameraFlowTests {
  private let photo = CameraFixtures.photo(lines: ["GREEN TEA 300", "COFFEE 450"])

  @Test func aTranslationShowsFromItsFirstItemAndEndsAnswered() async throws {
    let photo = try #require(photo)
    let generator = CameraGenerator(
      .held([#"{"title":"Menu"}"# + "\n", #"{"lines":[1],"text":"绿茶","price":"300"}"# + "\n"]))
    let flow = CameraFlow()
    flow.capturing()
    #expect(flow.phase == .capturing && !flow.showsResult)
    flow.run(photo, command: try command(BuiltinCommands.translateID), generator: generator)
    // The sheet comes up with the first item while the rest is still on its way.
    #expect(await eventually { flow.answer != nil })
    #expect(flow.phase == .reading && flow.showsResult)
    guard case .translation(let first) = flow.answer else {
      Issue.record("not a translation")
      return
    }
    #expect(first.title == "Menu" && first.items.map(\.text) == ["绿茶"])
    generator.finish(with: [#"{"lines":[2],"text":"咖啡","price":"450"}"#])
    #expect(await eventually { flow.phase == .answered })
    guard case .translation(let translation) = flow.answer else {
      Issue.record("not a translation")
      return
    }
    #expect(translation.items.map(\.text) == ["绿茶", "咖啡"])
    // One request, carrying the photo, made only once the photo was taken.
    #expect(generator.requests.count == 1)
    #expect(generator.requests.first?.messages.first?.images.count == 1)
    #expect(flow.modelImage != nil)
  }

  @Test func withoutAModelTheSamePhotoRunsOnceOneIsAdded() async throws {
    let photo = try #require(photo)
    let flow = CameraFlow()
    flow.run(
      photo, command: try command(BuiltinCommands.expenseID),
      generator: CameraGenerator(.failure(.noModel)))
    #expect(await eventually { flow.phase == .failed })
    #expect(flow.failure?.needsModel == true && flow.showsResult)
    let shot = try #require(flow.shot)
    flow.retry(generator: CameraGenerator(.text([#"{"amount":12,"merchant":"Tea House"}"#])))
    #expect(await eventually { flow.phase == .answered })
    #expect(flow.failure == nil)
    // The photo was read once; the retry ran the same shot.
    #expect(flow.shot?.image === shot.image)
    guard case .card(.expense(let draft), _) = flow.answer else {
      Issue.record("not an expense")
      return
    }
    #expect(draft.amount == 12 && draft.merchant == "Tea House")
  }

  @Test func aFailedRunSaysWhyAndWhetherToRetry() async throws {
    let photo = try #require(photo)
    let flow = CameraFlow()
    flow.run(
      photo, command: try command(BuiltinCommands.translateID),
      generator: CameraGenerator(.text(["Sorry, I can't help with that."])))
    #expect(await eventually { flow.phase == .failed })
    #expect(flow.failure == CameraFailure(ModelFailure.unreadable(detail: nil)))
    #expect(flow.failure?.canRetry == true && flow.failure?.needsModel == false)
  }

  @Test func retakingCancelsTheRunAndForgetsThePhoto() async throws {
    let photo = try #require(photo)
    let generator = CameraGenerator(.held([]))
    let flow = CameraFlow()
    flow.run(photo, command: try command(BuiltinCommands.translateID), generator: generator)
    #expect(await eventually { !generator.requests.isEmpty })
    flow.retake()
    generator.finish(with: [#"{"lines":[],"text":"late"}"#])
    try await Task.sleep(for: .milliseconds(300))
    #expect(flow.phase == .live && !flow.showsResult)
    #expect(flow.answer == nil && flow.failure == nil && flow.shot == nil)
  }
}

@MainActor @Suite struct CameraRunTests {
  private let image = ModelImage(data: Data([1, 2, 3]), mediaType: "image/jpeg")

  private func shot(_ texts: [String]) throws -> CameraShot {
    CameraShot(
      image: try #require(CameraFixtures.image(lines: [])), lines: CameraFixtures.lines(texts))
  }

  @Test func aCardAsksForTheLinesEachPartCameFrom() async throws {
    let expense = try command(BuiltinCommands.expenseID)
    let generator = CameraGenerator(
      .text([
        #"{"amount":46,"merchant":"FamilyMart","marks":[{"field":"total","lines":[3]},"#,
        #"{"field":"merchant","lines":[1]},{"field":"time","lines":[2]}]}"#,
      ]))
    let answer = try await CameraRun.run(
      expense, shot: try shot(["FamilyMart", "2026-11-21 15:20", "合计 ¥46.00"]), image: image,
      generator: generator
    ) { _ in }
    guard case .card(.expense(let draft), let marks) = answer else {
      Issue.record("not an expense")
      return
    }
    #expect(draft.merchant == "FamilyMart")
    #expect(
      marks == [
        CameraMark(number: 1, fields: [.merchant], lines: [1]),
        CameraMark(number: 2, fields: [.time], lines: [2]),
        CameraMark(number: 3, fields: [.total], lines: [3]),
      ])
    let request = try #require(generator.requests.first)
    #expect(request.system.contains(try #require(CameraMarks.rule(for: .expense))))
    #expect(request.messages.first?.text.contains("[3] 合计 ¥46.00") == true)
    #expect(request.messages.first?.images == [image])
  }

  @Test func aCommandOfThePersonsOwnReadsThePhotosTextAsPlainLines() async throws {
    var own = try command(BuiltinCommands.shortenID)
    own.id = "mine"
    own.placement.camera = true
    let generator = CameraGenerator(.text(["出口 3 号门"]))
    let answer = try await CameraRun.run(
      own, shot: try shot(["Exit", "Gate 3"]), image: nil, generator: generator
    ) { _ in }
    #expect(answer == .card(.text(TextCard(text: "出口 3 号门")), marks: []))
    let text = try #require(generator.requests.first?.messages.first?.text)
    #expect(text.contains("Exit\nGate 3") && !text.contains("[1]"))
  }
}
