import Foundation
import Testing

@testable import AICore

@MainActor
@Suite("System activity reporter")
final class SystemActivityReporterTests {
  struct Refused: Error {}

  var online = true
  var failReports = false
  var idle = 12.0
  private(set) var sent: [Double] = []
  private(set) var failures = 0
  /// Each pending wait of the interval; resuming one ends that wait.
  private var waits: [CheckedContinuation<Void, Error>] = []
  private(set) var reporter: SystemActivityReporter!

  init() {
    reporter = SystemActivityReporter(
      connect: { [unowned self] in online ? service : nil },
      idleSeconds: { [unowned self] in idle },
      sleep: { [weak self] _ in try await self?.wait() },
      report: { [unowned self] _ in failures += 1 })
  }

  private var service: SystemActivityReporter.Service {
    { [weak self] report in try await self?.receive(report) }
  }

  private func receive(_ report: SystemActivityReport) throws {
    if failReports { throw Refused() }
    sent.append(report.idleSeconds)
  }

  private func wait() async throws {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { waits.append($0) }
    } onCancel: {
    }
  }

  /// Ends the interval being waited on, as if a minute passed, and lets the next report run.
  private func tick() async {
    let waiting = waits
    waits = []
    for wait in waiting { wait.resume() }
    await settle()
  }

  private func settle() async {
    for _ in 0..<20 { await Task.yield() }
  }

  @Test func reportsOnConnectionThenEveryInterval() async {
    reporter.start()
    await settle()
    #expect(sent == [12])
    idle = 70
    await tick()
    idle = 130
    await tick()
    #expect(sent == [12, 70, 130])
  }

  @Test func stopsReportingWhileTheLinkIsDown() async {
    reporter.start()
    await settle()
    reporter.stop()
    await tick()
    #expect(sent == [12])
    #expect(!reporter.isRunning)
  }

  @Test func aNewConnectionReportsAtOnce() async {
    reporter.start()
    await settle()
    reporter.stop()
    reporter.start()
    await settle()
    #expect(sent == [12, 12])
  }

  @Test func wakeReportsOnlyWhileConnected() async {
    reporter.reportNow()
    await settle()
    #expect(sent.isEmpty)
    reporter.start()
    await settle()
    idle = 3600
    reporter.reportNow()
    await settle()
    #expect(sent == [12, 3600])
  }

  @Test func failuresAreReportedAndTheScheduleContinues() async {
    failReports = true
    reporter.start()
    await settle()
    #expect(failures == 1)
    failReports = false
    await tick()
    #expect(sent == [12])
  }

  @Test func anUnavailableServiceSkipsTheReport() async {
    online = false
    reporter.start()
    await settle()
    #expect(sent.isEmpty && failures == 0)
    online = true
    await tick()
    #expect(sent == [12])
  }
}

@Suite("System activity report")
struct SystemActivityReportTests {
  @Test func encodesTheContractBody() throws {
    let json = try JSONEncoder().encode(SystemActivityReport(idleSeconds: 42.5))
    #expect(String(decoding: json, as: UTF8.self) == #"{"idleSeconds":42.5}"#)
  }

  @Test func keepsTheValueInsideTheContractRange() {
    #expect(SystemActivityReport(idleSeconds: -1).idleSeconds == 0)
    #expect(SystemActivityReport(idleSeconds: .nan).idleSeconds == 0)
    #expect(SystemActivityReport(idleSeconds: .infinity).idleSeconds == 31_536_000)
    #expect(SystemActivityReport(idleSeconds: 1e12).idleSeconds == 31_536_000)
  }
}
