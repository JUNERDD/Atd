import AtdAI
import AtdActions
import AtdModel
import Foundation
import Testing

@testable import AtdShareUI

/// A text command run on a share: versions streamed once each, what is remembered, stopping,
/// failures, and a shared link's page read only when a command runs.
@MainActor @Suite struct ShareRunTests {
  private let text = SharedContent.text("这个月我们一起读《慢下来的城市》，聊聊步行、街角和邻里。")

  private func run(_ id: String, _ world: ShareWorld, content: SharedContent? = nil) -> ShareRun {
    ShareRun(command: world.command(id), content: content ?? text, services: world.services)
  }

  /// 缩短 starts at 要点 in the share sheet, which reads as a list, and the command's own
  /// default stays as it was.
  @Test func shortenStartsAtKeyPointsWithoutRememberingThem() async throws {
    let world = ShareWorld(model: FakeModel(answering: "· 一起读书\n· 聊步行和街角"))
    let run = run(BuiltinCommands.shortenID, world)
    run.start()
    await run.settle()
    let axis = try #require(run.axis)
    #expect(run.choice == axis.choices[2])
    #expect(run.items == ["一起读书", "聊步行和街角"])
    #expect(world.remembered.isEmpty)

    run.copyResult()
    #expect(world.copied == ["· 一起读书\n· 聊步行和街角"])
    #expect(run.copied)

    run.select(axis.choices[0])
    #expect(!run.copied)
    #expect(world.remembered.isEmpty)
  }

  /// 翻译's 译成 is remembered as the command's, each language is asked for once, and going
  /// back to one shows it again without a new request.
  @Test func eachVersionStreamsOnceAndTranslateRemembersItsLanguage() async throws {
    let world = ShareWorld(model: FakeModel { request in .text("译文 \(request.system.count)") })
    let run = run(BuiltinCommands.translateID, world)
    run.start()
    await run.settle()
    let axis = try #require(run.axis)
    let first = run.choice
    let other = try #require(axis.choices.first { $0 != first })
    #expect(run.version?.state == .finished)

    run.select(other)
    await run.settle()
    #expect(world.remembered == [[other, axis.key, BuiltinCommands.translateID]])
    #expect(world.model.requests.count == 2)
    #expect(world.model.requests[1].system.contains(other))

    run.select(first)
    await run.settle()
    #expect(world.model.requests.count == 2)
    #expect(run.version?.state == .finished)
  }

  /// Leaving a version mid-answer drops what arrived, so it is asked for again when shown.
  @Test func aStoppedVersionStartsOverWhenShownAgain() async throws {
    let world = ShareWorld(model: FakeModel { _ in .hanging("半句") })
    let run = run(BuiltinCommands.translateID, world)
    run.start()
    try await until { run.version?.text == "半句" }
    let first = run.choice
    let other = try #require(run.axis?.choices.first { $0 != first })
    run.select(other)
    #expect(run.versions[first] == nil)
    run.stop()
    #expect(run.versions[other] == nil)
  }

  @Test func aCutOffAnswerKeepsWhatArrived() async {
    let world = ShareWorld(model: FakeModel { _ in .failing("一半的译文", .truncated) })
    let run = run(BuiltinCommands.translateID, world)
    run.start()
    await run.settle()
    #expect(run.version?.state == .truncated)
    #expect(run.version?.text == "一半的译文")
  }

  @Test func aFailedVersionSaysWhyAndCanBeRetried() async {
    let world = ShareWorld(model: FakeModel { _ in .failing("", .offline) })
    let run = run(BuiltinCommands.translateID, world)
    run.start()
    await run.settle()
    #expect(run.version?.state == .failed(.model(.offline)))
    #expect(ShareFailure.model(.offline).canRetry)

    run.retry()
    await run.settle()
    #expect(world.model.requests.count == 2)
  }

  /// A link shared without its page is read when the command runs, once: the session keeps the
  /// text for the next command, and the request carries it.
  @Test func aSharedLinksPageIsReadWhenACommandRuns() async throws {
    let world = ShareWorld(model: FakeModel(answering: "· 周六共读"))
    let url = try #require(URL(string: "https://dushu.example.cn/nov"))
    world.pages.pages[url] = SharedPage(url: url, title: "城市读书会", text: "3月8日周六共读")
    let session = ShareSession(services: world.services, complete: {}, dismiss: {})
    session.show(.page(SharedPage(url: url, title: nil, text: nil)))
    guard case .ready(_, let menu) = session.phase, let entry = menu.others.first else {
      Issue.record("no commands listed")
      return
    }
    #expect(world.pages.reads.isEmpty)

    session.open(entry)
    let run = try #require(session.run)
    await run.settle()
    #expect(world.pages.reads == [url])
    #expect(world.model.requests.first?.messages.first?.text.contains("3月8日周六共读") == true)
    guard case .ready(.page(let read), _) = session.phase else {
      Issue.record("the session lost the page")
      return
    }
    #expect(read.text == "3月8日周六共读")
  }

  @Test func aPageThatDoesNotLoadCanBeTriedAgain() async throws {
    let world = ShareWorld(model: FakeModel(answering: "译文"))
    let url = try #require(URL(string: "https://dushu.example.cn/nov"))
    world.pages.failure = .offline
    let run = run(
      BuiltinCommands.translateID, world,
      content: .page(SharedPage(url: url, title: nil, text: nil)))
    #expect(run.phase == .working(.readingPage))
    run.start()
    await run.settle()
    #expect(run.phase == .failed(.page(.offline)))
    #expect(world.model.requests.isEmpty)

    world.pages.failure = nil
    world.pages.pages[url] = SharedPage(url: url, title: "共读", text: "正文")
    run.retry()
    await run.settle()
    #expect(run.phase == .text)
    #expect(run.version?.text == "译文")
  }

  @Test func noModelMeansNoList() {
    let world = ShareWorld(model: FakeModel(answering: ""))
    world.hasModel = false
    let session = ShareSession(services: world.services, complete: {}, dismiss: {})
    session.show(text)
    #expect(session.phase == .noModel)
    session.show(nil)
    #expect(session.phase == .unreadable)
  }
}

/// Waits a little at a time until `condition` holds; a test fails rather than hangs.
@MainActor func until(_ condition: () -> Bool) async throws {
  for _ in 0..<200 where !condition() {
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(condition())
}
