import Testing

@testable import AICore

@Suite("Insertion trace queue")
struct InsertionTraceQueueTests {
  typealias Run = InsertionTrace.Run

  static let first = Run("ab", from: 0, to: 2)
  static let second = Run("cd", from: 2, to: 4)
  static let third = Run("ef", from: 4, to: 6)

  @Test("The first run is read at once")
  func firstRead() {
    var queue = InsertionTraceQueue()
    #expect(queue.add(Self.first) == .read(Self.first))
  }

  @Test("Runs that go in during a read merge into one read once it is done")
  func mergeWhileReading() {
    var queue = InsertionTraceQueue()
    #expect(queue.add(Self.first) == .read(Self.first))
    #expect(queue.add(Self.second) == .wait)
    #expect(queue.add(Self.third) == .wait)
    var merged = Self.second
    merged.merge(Self.third)
    #expect(queue.readDone() == .read(merged))
    // Nothing left and the write still going: wait for the next run.
    #expect(queue.readDone() == .wait)
    #expect(queue.add(Self.first) == .read(Self.first))
  }

  @Test("A write that ends during a read closes only after the reads still due")
  func finishWhileReading() {
    var queue = InsertionTraceQueue()
    _ = queue.add(Self.first)
    #expect(queue.add(Self.second) == .wait)
    #expect(queue.finish() == .wait)
    #expect(queue.readDone() == .read(Self.second))
    #expect(queue.readDone() == .close)
    // Closed once: later events change nothing.
    #expect(queue.readDone() == .wait)
    #expect(queue.finish() == .wait)
    #expect(queue.add(Self.third) == .wait)
  }

  @Test("A write that ends with no read running closes at once, and only once")
  func finishIdle() {
    var idle = InsertionTraceQueue()
    #expect(idle.finish() == .close)
    #expect(idle.finish() == .wait)
    #expect(idle.add(Self.first) == .wait)
    var read = InsertionTraceQueue()
    _ = read.add(Self.first)
    #expect(read.readDone() == .wait)
    #expect(read.finish() == .close)
    #expect(read.readDone() == .wait)
  }
}
