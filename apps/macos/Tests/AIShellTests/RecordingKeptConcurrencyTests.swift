import AICore
import Foundation
import Testing

@testable import AIShell

@Suite("Recording file reader ownership")
nonisolated struct RecordingKeptConcurrencyTests {
  @Test("Dropping a take waits for its final registered reader")
  func lastReaderDeletesDroppedTake() async throws {
    let fixture = try KeptFileFixture()
    defer { fixture.dispose() }
    let kept = fixture.kept
    try #require(kept.hold())
    try #require(kept.hold())
    await Task.detached {
      kept.drop()
      kept.drop()
    }.value
    #expect(!kept.hold())
    #expect(try Data(contentsOf: fixture.file) == fixture.bytes)

    await Task.detached { kept.letGo() }.value
    #expect(try Data(contentsOf: fixture.file) == fixture.bytes)
    await Task.detached { kept.letGo() }.value
    #expect(!FileManager.default.fileExists(atPath: fixture.takeFolder.path))
    #expect(!kept.hold())
    kept.drop()
    #expect(!FileManager.default.fileExists(atPath: fixture.takeFolder.path))
  }

  @Test("Concurrent reader registration and drop never remove a live reader's file")
  func readersRaceWithDrop() async throws {
    let fixture = try KeptFileFixture()
    defer { fixture.dispose() }
    let kept = fixture.kept
    // This registered reader makes the filesystem guarantee observable even if drop wins
    // every racing registration. The other test proves the final-reader deletion boundary.
    try #require(kept.hold())
    let gate = ReaderStartGate(participants: 33)
    let outcomes = try await withThrowingTaskGroup(of: ReaderOutcome.self) { group in
      for _ in 0..<32 {
        group.addTask {
          await gate.arrive()
          guard kept.hold() else { return .refused }
          defer { kept.letGo() }
          try #require(Data(contentsOf: fixture.file) == fixture.bytes)
          return .read
        }
      }
      group.addTask {
        await gate.arrive()
        kept.drop()
        kept.drop()
        return .dropped
      }
      var outcomes: [ReaderOutcome] = []
      for try await outcome in group { outcomes.append(outcome) }
      return outcomes
    }
    #expect(outcomes.filter { $0 == .dropped }.count == 1)
    #expect(outcomes.filter { $0 != .dropped }.count == 32)
    #expect(!kept.hold())
    #expect(try Data(contentsOf: fixture.file) == fixture.bytes)
    await Task.detached { kept.letGo() }.value
    #expect(!FileManager.default.fileExists(atPath: fixture.takeFolder.path))
    #expect(!kept.hold())
  }
}

private nonisolated enum ReaderOutcome: Sendable {
  case read
  case refused
  case dropped
}

/// All participants reach this gate before registration competes with dropping the take.
private actor ReaderStartGate {
  private var remaining: Int
  private var waiters: [CheckedContinuation<Void, Never>] = []

  init(participants: Int) { remaining = participants }

  func arrive() async {
    remaining -= 1
    if remaining == 0 {
      for waiter in waiters { waiter.resume() }
      waiters.removeAll()
      return
    }
    await withCheckedContinuation { waiters.append($0) }
  }
}

/// These tests exercise file ownership only, so the shared result factory copies known bytes
/// as its movie. No decoder, encoder, UI, model request or user file is involved.
private nonisolated struct KeptFileFixture: Sendable {
  let root: URL
  let takeFolder: URL
  let file: URL
  let bytes: Data
  let kept: RecordingKept

  init() throws {
    let root = URL.temporaryDirectory.appending(path: "recording-readers-\(UUID())")
    let mediaFolder = root.appending(path: "media")
    let media = RecordingMediaFixture(
      folder: mediaFolder, movie: mediaFolder.appending(path: "source.mp4"),
      width: 1920, height: 1080, duration: 2)
    let bytes = Data((0..<4096).map { UInt8($0 % 251) })
    do {
      try FileManager.default.createDirectory(at: mediaFolder, withIntermediateDirectories: true)
      try bytes.write(to: media.movie)
      let result = try media.result(in: root.appending(path: "take"))
      let source = RecordingCardSource(
        id: UUID().uuidString, movie: result.movie, duration: result.duration,
        pixelWidth: result.take.pixelWidth, pixelHeight: result.take.pixelHeight,
        pointSize: WindowSize(
          width: result.take.pointSize.width, height: result.take.pointSize.height),
        appName: result.app, steps: [], narration: false)
      self.root = root
      takeFolder = result.take.folder
      file = result.movie
      self.bytes = bytes
      kept = RecordingKept(result, source: source)
    } catch {
      try? FileManager.default.removeItem(at: root)
      throw error
    }
  }

  func dispose() { try? FileManager.default.removeItem(at: root) }
}
