import Testing

@testable import AICore

@Suite("Browser text geometry")
struct BrowserTextGeometryTests {
  // Whole seconds on a plain integer clock keep the lease arithmetic readable. `#expect` cannot
  // call a mutating member, so each step's answer is taken first and checked after.
  typealias Leases = BrowserTextGeometry.Leases<Int>

  @Test("Chromium browsers are armed; Electron editors, Safari and unknown apps are not")
  func arms() {
    for browser in [
      "com.google.Chrome", "company.thebrowser.Browser", "company.thebrowser.dia",
      "at.studio.AsideBrowser",
    ] {
      #expect(BrowserTextGeometry.arms(browser), "\(browser)")
    }
    // Electron editors ask about screen readers and write a setting when armed.
    for app in [
      "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "notion.id", "com.electron.lark",
      "com.apple.Safari",
    ] {
      #expect(!BrowserTextGeometry.arms(app), "\(app)")
    }
    #expect(!BrowserTextGeometry.arms(nil))
  }

  @Test("The first request turns the mode on; a repeat only extends the lease")
  func requestOnce() {
    var leases = Leases()
    let first = leases.request(7, until: 60)
    let repeated = leases.request(7, until: 90)
    #expect(first)
    #expect(!repeated)
    #expect(leases.nextExpiry == 90)
    let confirmed = leases.confirm(7)
    #expect(confirmed)
    // The first deadline has passed, but the extended lease still holds.
    let atFirst = leases.expire(at: 60)
    let atExtended = leases.expire(at: 90)
    #expect(atFirst.isEmpty)
    #expect(atExtended == [7])
  }

  @Test("A request never shortens a longer lease")
  func requestKeepsLonger() {
    var leases = Leases()
    _ = leases.request(7, until: 60)
    let shorter = leases.request(7, until: 10)
    #expect(!shorter)
    #expect(leases.nextExpiry == 60)
  }

  @Test("A confirm after the lease ended tells the caller to turn the mode off again")
  func confirmAfterExpiry() {
    var leases = Leases()
    _ = leases.request(7, until: 60)
    let ended = leases.expire(at: 60)
    let confirmed = leases.confirm(7)
    #expect(ended.isEmpty)
    #expect(!confirmed)
    // Nothing is held for it afterwards.
    #expect(leases.nextExpiry == nil)
    let rest = leases.expireAll()
    #expect(rest.isEmpty)
  }

  @Test("A mode the shell never confirmed turning on is never turned off")
  func unconfirmedStays() {
    var leases = Leases()
    _ = leases.request(7, until: 60)
    _ = leases.request(8, until: 60)
    _ = leases.confirm(8)
    let due = leases.expire(at: 60)
    #expect(due == [8])
    _ = leases.request(9, until: 60)
    let all = leases.expireAll()
    #expect(all.isEmpty)
  }

  @Test("Expiry ends every due lease, reports only owned ones, and keeps later leases")
  func expireDue() {
    var leases = Leases()
    for pid: Int32 in [3, 1, 2, 4] { _ = leases.request(pid, until: pid == 4 ? 100 : 50) }
    for pid: Int32 in [3, 1, 4] { _ = leases.confirm(pid) }
    let early = leases.expire(at: 49)
    #expect(early.isEmpty)
    // Sorted, and pid 2 (never confirmed) ends with the others without being reported.
    let due = leases.expire(at: 50)
    #expect(due == [1, 3])
    #expect(leases.nextExpiry == 100)
    let renewed = leases.request(2, until: 120)
    #expect(renewed, "pid 2's lease ended, so a new one turns its mode on again")
    let later = leases.expire(at: 100)
    #expect(later == [4])
  }

  @Test("A shortened lease ends at the new time, but shortening never lengthens it")
  func shorten() {
    var leases = Leases()
    _ = leases.request(7, until: 60)
    _ = leases.confirm(7)
    leases.shorten(7, to: 80)
    #expect(leases.nextExpiry == 60)
    leases.shorten(7, to: 11)
    #expect(leases.nextExpiry == 11)
    let due = leases.expire(at: 11)
    #expect(due == [7])
  }

  @Test("Shortening an app the shell holds no lease on changes nothing")
  func shortenUnknown() {
    var leases = Leases()
    leases.shorten(7, to: 11)
    #expect(leases == Leases())
    _ = leases.request(8, until: 60)
    let held = leases
    leases.shorten(7, to: 11)
    #expect(leases == held)
  }

  @Test("Ending every lease reports the owned apps and leaves nothing held")
  func expireAll() {
    var leases = Leases()
    for pid: Int32 in [5, 3, 4] { _ = leases.request(pid, until: Int(pid) * 10) }
    _ = leases.confirm(5)
    _ = leases.confirm(3)
    let owned = leases.expireAll()
    #expect(owned == [3, 5])
    #expect(leases.nextExpiry == nil)
    let again = leases.expireAll()
    #expect(again.isEmpty)
    let fresh = leases.request(4, until: 10)
    #expect(fresh)
  }

  @Test("The next expiry is the earliest lease held, and nil while none is")
  func nextExpiry() {
    var leases = Leases()
    #expect(leases.nextExpiry == nil)
    _ = leases.request(1, until: 90)
    _ = leases.request(2, until: 30)
    _ = leases.request(3, until: 60)
    #expect(leases.nextExpiry == 30)
    _ = leases.expire(at: 30)
    #expect(leases.nextExpiry == 60)
    _ = leases.expire(at: 90)
    #expect(leases.nextExpiry == nil)
  }
}
