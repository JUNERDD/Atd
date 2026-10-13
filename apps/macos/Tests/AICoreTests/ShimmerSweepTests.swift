import Testing

@testable import AICore

@Suite("Shimmer sweep")
struct ShimmerSweepTests {
  @Test("matches the page's defaults: 2 s a sweep, 2 pt a character")
  func defaults() {
    #expect(ShimmerSweep.duration == 2)
    #expect(ShimmerSweep.spreadPerCharacter == 2)
    #expect(ShimmerSweep.locations == [0, 0.5, 1])
  }

  @Test("the band clears the ink at both ends, so a new sweep never pops in over the text")
  func travel() throws {
    let sweep = try #require(ShimmerSweep(inkMinX: 10, inkMaxX: 95, characters: 14))
    #expect(sweep.spread == 28)
    #expect(sweep.bandWidth == 56)
    // Its trailing side touches the leading edge as it starts, its leading side the trailing
    // edge as it ends: off the text both times.
    #expect(sweep.startCenter + sweep.spread == 10)
    #expect(sweep.endCenter - sweep.spread == 95)
    // The same for a short Latin name, whose band is wider than a quarter of the text.
    let short = try #require(ShimmerSweep(inkMinX: 0, inkMaxX: 30, characters: 5))
    #expect(short.startCenter + short.spread <= 0)
    #expect(short.endCenter - short.spread >= 30)
  }

  @Test("a truncated label counts only the characters it shows")
  func truncation() {
    #expect(ShimmerSweep.shownCharacters(82, shownWidth: 220, fullWidth: 550) == 33)
    #expect(ShimmerSweep.shownCharacters(14, shownWidth: 85, fullWidth: 85) == 14)
    #expect(ShimmerSweep.shownCharacters(14, shownWidth: 90, fullWidth: 85) == 14)
  }

  @Test("characters count as the page's string length does")
  func characters() {
    #expect(ShimmerSweep.characters(in: "Translate") == 9)
    #expect(ShimmerSweep.characters(in: "润色文字") == 4)
    #expect(ShimmerSweep.characters(in: "🚀") == 2)
  }

  @Test("no ink, nothing to sweep")
  func empty() {
    #expect(ShimmerSweep(inkMinX: 5, inkMaxX: 5, characters: 3) == nil)
    #expect(ShimmerSweep(inkMinX: 0, inkMaxX: .infinity, characters: 3) == nil)
    #expect(ShimmerSweep(inkMinX: 0, inkMaxX: 40, characters: 0) == nil)
  }

  @Test("sweeps keep one clock: the phase is the time modulo the duration, never negative")
  func phase() {
    #expect(ShimmerSweep.phase(at: 0) == 0)
    #expect(abs(ShimmerSweep.phase(at: 2.5) - 0.5) < 1e-9)
    #expect(abs(ShimmerSweep.phase(at: -0.5) - 1.5) < 1e-9)
    // A sweep added 0.3 s after another is 0.3 s further along, wherever the cycle wraps.
    let early = ShimmerSweep.phase(at: 101.9)
    let late = ShimmerSweep.phase(at: 102.2)
    #expect(abs((late - early + 2).truncatingRemainder(dividingBy: 2) - 0.3) < 1e-9)
  }
}
