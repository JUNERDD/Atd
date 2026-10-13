import Testing

@testable import AICore

@Suite("Typing pace")
struct TypingPaceTests {
  /// A simulated write: each chunk goes out when due (at once when late) and is confirmed as
  /// `latency` says, given its index and its confirmation limit; one slower than its limit stops
  /// the write as the shell does.
  struct Run {
    var chunks: [TypingPace.Chunk] = []
    var lastPaste: Duration = .zero
    var end: Duration = .zero
    var timedOut = false
    var texts: [String] { chunks.map(\.text) }
  }

  static func simulate(
    _ text: String, start: Duration = .zero, typing: Bool = true, reduceMotion: Bool = false,
    tracked: Bool = true, latency: (_ index: Int, _ limit: Duration) -> Duration = { _, _ in .zero }
  ) -> Run {
    var pace = TypingPace(text, typing: typing, reduceMotion: reduceMotion, caretTracked: tracked)
    var run = Run()
    var now = start
    while let chunk = pace.next(at: now) {
      let pasted = max(now, chunk.due)
      let limit = TypingPace.confirmationLimit(for: chunk, pastedAt: pasted)
      let took = latency(run.chunks.count, limit)
      run.chunks.append(chunk)
      run.lastPaste = pasted
      guard took <= limit else {
        run.timedOut = true
        now = pasted + limit
        break
      }
      now = pasted + took
    }
    run.end = now
    return run
  }

  static let maxChunks = Int(TypingPace.budget / TypingPace.tick) + 1

  @Test("The constants keep the write well under two seconds")
  func constants() {
    #expect(TypingPace.tick == .milliseconds(20) && TypingPace.baseChunk == 4)
    #expect(TypingPace.budget + TypingPace.margin < TypingPace.deadline)
    #expect(TypingPace.deadline < .seconds(2))
  }

  @Test("Short text types at the base rate, one chunk a tick, and the chunks rebuild it")
  func shortText() {
    #expect(Self.simulate("").chunks.isEmpty)
    let hello = Self.simulate("hello")
    #expect(hello.texts == ["hell", "o"])
    #expect(hello.chunks.map(\.due) == [.zero, TypingPace.tick])
    #expect(hello.chunks.map(\.isLast) == [false, true])
    let text = String(repeating: "a\n", count: 20)
    let run = Self.simulate(text, latency: { _, _ in .milliseconds(3) })
    #expect(run.texts.count == 10)
    #expect(run.texts.allSatisfy { $0.count == TypingPace.baseChunk })
    #expect(run.chunks.enumerated().allSatisfy { $1.due == TypingPace.tick * $0 })
    #expect(run.texts.joined() == text)
    #expect(!run.timedOut && run.end < .milliseconds(200))
  }

  @Test(
    "Long text finishes within the budget in larger chunks, however slow the field",
    arguments: [5_000, 50_000])
  func longText(count: Int) {
    let text = String(repeating: "x", count: count)
    for latency in [0, 5, 19, 30, 120, 300, 450].map(Duration.milliseconds) {
      let run = Self.simulate(text, latency: { _, _ in latency })
      #expect(!run.timedOut)
      #expect(run.texts.joined() == text)
      #expect(run.chunks.count <= Self.maxChunks)
      #expect(run.chunks.last?.isLast == true)
      #expect(run.lastPaste <= TypingPace.budget)
      #expect(run.end <= TypingPace.budget + latency)
      #expect(run.end <= TypingPace.deadline)
    }
    // A fast field: one chunk every tick until the budget, the text shared evenly among them.
    let fast = Self.simulate(text)
    #expect(fast.chunks.count == Self.maxChunks)
    #expect(fast.chunks.last?.due == TypingPace.budget)
    let sizes = fast.texts.map(\.count)
    #expect((sizes.max() ?? 0) - (sizes.min() ?? 0) <= 1)
    #expect(sizes.allSatisfy { $0 > TypingPace.baseChunk })
  }

  @Test("A slow field gets fewer, larger chunks, the next one due once the last is in")
  func slowField() {
    let text = String(repeating: "y", count: 5_000)
    let late = Self.simulate(text, latency: { _, _ in .milliseconds(50) })
    #expect(late.chunks.count > 2)
    #expect(late.chunks[1].due == .milliseconds(50))
    let slow = Self.simulate(text, latency: { _, _ in .milliseconds(400) })
    let dues = slow.chunks.map(\.due)
    #expect(dues == [0, 400, 800, 1_200].map(Duration.milliseconds))
    #expect(slow.texts.joined() == text)
    #expect(!slow.timedOut && slow.end == .milliseconds(1_600))
    // A slow first paste, then a fast field: the rest still types and lands in time.
    let warmUp = Self.simulate(
      text, latency: { index, _ in index == 0 ? .milliseconds(600) : .milliseconds(10) })
    #expect(!warmUp.timedOut && warmUp.chunks.count > 2)
    #expect(warmUp.texts.joined() == text && warmUp.end <= TypingPace.budget + .milliseconds(10))
  }

  @Test("Once no further cycle fits, everything left goes in one final chunk")
  func finalRemainder() {
    let text = String(repeating: "z", count: 900)
    var pace = TypingPace(text, typing: true, reduceMotion: false, caretTracked: true)
    let first = pace.next(at: .zero)
    #expect(first?.isLast == false)
    // Confirmed 1.19 s later: the next tick would fall past the budget.
    let rest = pace.next(at: .milliseconds(1_190))
    #expect(rest?.isLast == true && rest?.due == .milliseconds(1_190))
    #expect((first?.text ?? "") + (rest?.text ?? "") == text)
    #expect(pace.next(at: .milliseconds(1_300)) == nil)
    // A write whose first caret read took long starts with no time to type: one paste.
    let lateStart = Self.simulate(text, start: .milliseconds(1_300))
    #expect(lateStart.texts == [text] && lateStart.chunks.first?.isLast == true)
    #expect(TypingPace.size(of: 100, at: TypingPace.budget, cycle: TypingPace.tick) == 100)
    #expect(TypingPace.size(of: 2, at: .zero, cycle: TypingPace.tick) == 2)
  }

  @Test("No wait runs past the deadline, and the last chunk keeps time to go in")
  func waitsStayInBudget() {
    let last = TypingPace.Chunk(text: "a", due: .zero, isLast: true)
    let other = TypingPace.Chunk(text: "a", due: .zero, isLast: false)
    #expect(TypingPace.confirmationLimit(for: other, pastedAt: .seconds(1)) == .milliseconds(500))
    #expect(TypingPace.confirmationLimit(for: last, pastedAt: .seconds(1)) == .milliseconds(900))
    #expect(TypingPace.confirmationLimit(for: last, pastedAt: .seconds(2)) == .zero)
    // Every chunk takes its whole limit: the write still ends at the deadline.
    for count in [10, 300, 5_000, 50_000] {
      let worst = Self.simulate(String(repeating: "w", count: count), latency: { $1 })
      #expect(!worst.timedOut && worst.end <= TypingPace.deadline)
      let finalLimit = TypingPace.deadline - worst.lastPaste
      #expect(finalLimit >= TypingPace.deadline - TypingPace.budget - TypingPace.margin)
    }
    // A chunk slower than its limit stops the write before the deadline.
    let stuck = Self.simulate("stuck field", latency: { _, _ in .seconds(5) })
    #expect(stuck.timedOut && stuck.chunks.count == 1)
    #expect(stuck.end == TypingPace.budget + TypingPace.margin)
  }

  @Test("Typing off, reduced motion or an unreadable caret paste the text whole, unchanged")
  func wholePaste() {
    let text = String(repeating: "Welcome to the paste pipeline. ", count: 200)
    let start = Duration.milliseconds(30)
    for run in [
      Self.simulate(text, start: start, typing: false),
      Self.simulate(text, start: start, reduceMotion: true),
      Self.simulate(text, start: start, tracked: false),
    ] {
      #expect(run.texts == [text])
      #expect(run.chunks.first?.due == start && run.chunks.first?.isLast == true)
      #expect(run.end == start)
    }
    let chunk = TypingPace.Chunk(text: text, due: start, isLast: true)
    #expect(TypingPace.confirmationLimit(for: chunk, pastedAt: start) == .milliseconds(1_870))
  }

  @Test("Only typing on, motion not reduced and a tracked caret pace the text")
  func isPaced() {
    for typing in [false, true] {
      for reduceMotion in [false, true] {
        for tracked in [false, true] {
          let pace = TypingPace(
            "hello", typing: typing, reduceMotion: reduceMotion, caretTracked: tracked)
          #expect(pace.isPaced == (typing && !reduceMotion && tracked))
        }
      }
    }
  }

  @Test("Chunks never split a character")
  func graphemes() {
    let family = "👩‍👩‍👧‍👦"
    let thumb = "👍🏽"
    let accented = "e\u{301}\u{328}"
    let text = family + "\r\n" + thumb + accented + "a" + family + "\r\n"
    #expect(
      Self.simulate(text).texts == [family + "\r\n" + thumb + accented, "a" + family + "\r\n"])
    let long = String(repeating: family + "\r\n" + accented, count: 2_000)
    let run = Self.simulate(long)
    // A split inside a character would change the characters the chunks add up to.
    #expect(run.texts.count > 1)
    #expect(run.texts.flatMap(Array.init) == Array(long))
  }
}
