import AppKit
import Testing

@testable import AIShell

@MainActor
@Suite("Recording preparation lifetime", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct RecordingPreparationLifecycleTests {
  @Test("Immediate cancellation releases the reader registered before scheduling")
  func immediateCancellationReleasesReader() async throws {
    let media = try await RecordingMediaFixture.make()
    defer { media.dispose() }
    let fixture = try await RecordingPreparationFixture.make()
    defer { fixture.dispose() }
    for entry in CancellationEntry.allCases {
      let result = try media.result(in: fixture.folder("immediate"))
      let old = fixture.install(result)
      let pending = try fixture.ask()
      entry.cancel(fixture, askID: pending.id)
      await pending.task.value
      #expect(fixture.controller.preparingAsks.isEmpty)
      #expect(fixture.controller.runningAsks.isEmpty)
      #expect(fixture.stub.requests == 0)
      if entry != .replace {
        #expect(fixture.exists(result.take.movie))
        #expect(
          try fixture.contents(of: result.take.folder).allSatisfy {
            !$0.lastPathComponent.hasPrefix("export-")
          })
      }
      fixture.controller.dropLastRecording()
      #expect(old.value == nil)
      #expect(!fixture.exists(result.take.folder))
    }
  }

  @Test("Stop, replacement and document unload end real media work and release its files")
  func cancellationReleasesPreparation() async throws {
    print("recording-lifecycle encoding-input")
    let media = try await RecordingMediaFixture.make()
    defer {
      media.dispose()
      #expect(!FileManager.default.fileExists(atPath: media.folder.path))
    }
    print("recording-lifecycle creating-controller")
    let fixture = try await RecordingPreparationFixture.make()
    defer { fixture.dispose() }
    print(
      "recording-lifecycle input=\(media.width)x\(media.height) duration=\(media.duration)s "
        + "profile=\(RecordingMediaFixture.profile) order=interleaved"
    )
    let warmups = RecordingMediaFixture.profile ? 2 : 0
    let rounds = RecordingMediaFixture.profile ? 10 : 1
    for round in 0..<(warmups + rounds) {
      for entry in CancellationEntry.allCases {
        try await cancelActiveExport(
          fixture: fixture, media: media, entry: entry,
          round: round - warmups + 1, warmup: round < warmups)
      }
    }
    for entry in CancellationEntry.allCases {
      try await cancellationWaitsForStartedImport(media: media, entry: entry)
    }
    fixture.dispose()
    try await Task.sleep(for: .milliseconds(200))
    let settled = try RecordingMemorySnapshot.read()
    print(
      "recording-lifecycle complete pid=\(getpid()) settled-rss=\(settled.residentBytes) "
        + "settled-footprint=\(settled.footprintBytes) tracked-preparations=0 retained-takes=0"
    )
    if ProcessInfo.processInfo.environment["ATD_RECORDING_PROFILE_HOLD"] == "1" {
      print("recording-lifecycle inspection-hold pid=\(getpid()) seconds=45")
      try await Task.sleep(for: .seconds(45))
    }
  }

  private func cancelActiveExport(
    fixture: RecordingPreparationFixture, media: RecordingMediaFixture,
    entry: CancellationEntry, round: Int, warmup: Bool
  ) async throws {
    let result = try media.result(in: fixture.folder(entry.rawValue))
    let old = fixture.install(result)
    let replacement = entry == .replace ? try media.result(in: fixture.folder("next")) : nil
    let descriptorsBefore = try FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count
    let sampler = try RecordingMemorySampler()
    let pending = try fixture.ask()
    do {
      let export = try await fixture.activeExport(in: result.take.folder)
      let completion = Task.detached(priority: Task.currentPriority) {
        await pending.task.value
        return ContinuousClock.now
      }
      let began = ContinuousClock.now
      entry.cancel(fixture, askID: pending.id)
      let cancelled = ContinuousClock.now
      let next = replacement.map { fixture.install($0) }
      let installed = ContinuousClock.now
      // The dictionary is cleared synchronously. Await this saved handle to prove the
      // application's preparation stack and cleanup defers actually returned.
      let finished = await completion.value
      let observedAt = ContinuousClock.now
      let latency = began.duration(to: observedAt)
      print(
        "recording-phases entry=\(entry.rawValue) round=\(round) warmup=\(warmup) "
          + "cancel-ms=\(milliseconds(began.duration(to: cancelled))) "
          + "install-ms=\(milliseconds(cancelled.duration(to: installed))) "
          + "finished-ms=\(milliseconds(began.duration(to: finished))) "
          + "main-resume-ms=\(milliseconds(finished.duration(to: observedAt))) "
          + "id=\(result.take.folder.lastPathComponent)")
      #expect(fixture.controller.preparingAsks.isEmpty)
      #expect(fixture.controller.runningAsks.isEmpty)
      #expect(!fixture.exists(export))
      #expect(fixture.stub.requests == 0)
      if let replacement {
        #expect(!fixture.exists(result.take.folder))
        #expect(old.value == nil)
        #expect(fixture.exists(replacement.take.movie))
        #expect(next?.value != nil)
      } else {
        #expect(fixture.exists(result.take.movie))
        #expect(old.value != nil)
      }
      fixture.controller.dropLastRecording()
      #expect(old.value == nil)
      #expect(next?.value == nil)
      #expect(!fixture.exists(result.take.folder))
      if let replacement { #expect(!fixture.exists(replacement.take.folder)) }
      try await Task.sleep(for: .milliseconds(200))
      let memory = try await sampler.finish()
      let descriptorsAfter = try FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count
      report(
        entry: entry, round: round, warmup: warmup, latency: latency, memory: memory,
        descriptors: (descriptorsBefore, descriptorsAfter))
    } catch {
      fixture.controller.stopAsk(pending.id)
      // An import is deliberately shielded from cancellation. Close its endpoint even if
      // the request has not arrived or reading its files failed, so failure cleanup can end.
      fixture.stub.stop()
      await pending.task.value
      fixture.controller.dropLastRecording()
      _ = try? await sampler.finish()
      throw error
    }
  }

  private func cancellationWaitsForStartedImport(
    media: RecordingMediaFixture, entry: CancellationEntry
  ) async throws {
    let fixture = try await RecordingPreparationFixture.make()
    defer { fixture.dispose() }
    let result = try media.result(in: fixture.folder("import-source"))
    let old = fixture.install(result)
    let pending = try fixture.ask()
    do {
      try await fixture.waitForImport()
      let paths = fixture.stub.paths.map { URL(filePath: $0) }
      let export = try #require(paths.first).deletingLastPathComponent()
      let replacement = entry == .replace ? try media.result(in: fixture.folder("next")) : nil
      entry.cancel(fixture, askID: pending.id)
      let next = replacement.map { fixture.install($0) }
      let completion = PreparationCompletion()
      let observed = Task {
        await pending.task.value
        completion.finished = true
      }
      try await Task.sleep(for: .milliseconds(200))
      #expect(!completion.finished)
      #expect(old.value != nil)
      #expect(fixture.exists(result.take.movie))
      #expect(paths.allSatisfy(fixture.exists))
      // The endpoint has not read a byte from these files yet. Complete a real read before
      // returning success, so removal after this response respects the service's ownership.
      let bytesRead = try fixture.stub.finishImport()
      #expect(bytesRead > 0)
      await pending.task.value
      await observed.value
      #expect(completion.finished)
      #expect(fixture.controller.preparingAsks.isEmpty)
      #expect(fixture.controller.runningAsks.isEmpty)
      #expect(!fixture.exists(export))
      if let replacement {
        #expect(!fixture.exists(result.take.folder))
        #expect(old.value == nil)
        #expect(fixture.exists(replacement.take.movie))
      } else {
        #expect(fixture.exists(result.take.movie))
        #expect(old.value != nil)
      }
      fixture.controller.dropLastRecording()
      #expect(old.value == nil)
      #expect(next?.value == nil)
      #expect(!fixture.exists(result.take.folder))
      if let replacement { #expect(!fixture.exists(replacement.take.folder)) }
      print(
        "recording-import cancellation=\(entry.rawValue) read-bytes=\(bytesRead) retained-takes=0")
    } catch {
      fixture.controller.stopAsk(pending.id)
      fixture.stub.stop()
      await pending.task.value
      throw error
    }
  }

  private func report(
    entry: CancellationEntry, round: Int, warmup: Bool, latency: Duration,
    memory: RecordingMemorySampler.Summary, descriptors: (before: Int, after: Int)
  ) {
    print(
      "recording-cancel entry=\(entry.rawValue) round=\(round) warmup=\(warmup) "
        + "latency-ms=\(milliseconds(latency)) "
        + "rss-before=\(memory.baseline.residentBytes) rss-peak=\(memory.peak.residentBytes) "
        + "rss-after=\(memory.after.residentBytes) "
        + "footprint-before=\(memory.baseline.footprintBytes) "
        + "footprint-peak=\(memory.peak.footprintBytes) "
        + "footprint-after=\(memory.after.footprintBytes) samples=\(memory.sampleCount) "
        + "max-sample-gap-ms=\(milliseconds(memory.maxSampleGap)) "
        + "open-fds-before=\(descriptors.before) open-fds-after=\(descriptors.after) "
        + "tracked-preparations=0 retained-takes=0 export-folders=0"
    )
  }

  func milliseconds(_ duration: Duration) -> String {
    let parts = duration.components
    return String(format: "%.3f", Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15)
  }
}

@MainActor
private enum CancellationEntry: String, CaseIterable {
  case stop
  case replace
  case unload

  func cancel(_ fixture: RecordingPreparationFixture, askID: String) {
    switch self {
    case .stop: fixture.controller.stopAsk(askID)
    case .replace: fixture.controller.dropLastRecording()
    case .unload: fixture.controller.pageDidUnload()
    }
  }
}

@MainActor
private final class PreparationCompletion {
  var finished = false
}
