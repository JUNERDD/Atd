import AppKit
import Testing

@testable import AIShell

// Keep these UI scheduling cases in the same serialized suite as the media lifetime checks.
extension RecordingPreparationLifecycleTests {
  @Test("Cancelled preparation completes cleanup without scheduling on the UI actor")
  func cleanupDoesNotWaitForUI() async throws {
    let media = try await RecordingMediaFixture.make()
    defer { media.dispose() }
    let fixture = try await RecordingPreparationFixture.make()
    defer { fixture.dispose() }
    let result = try media.result(in: fixture.folder("busy-ui"))
    let old = fixture.install(result)
    let pending = try fixture.ask()
    let started = DispatchSemaphore(value: 0)
    let watching = Task.detached {
      defer { started.signal() }
      return await Self.observeActiveExport(in: result.take.folder)
    }
    // Hold MainActor until cancellation so other UI tests cannot occupy the interval between
    // observing an active export and cancelling it. The exporter itself runs off this actor.
    let sawSignal = occupyUIUntilSignalled(started)
    let requested = ContinuousClock.now
    fixture.controller.dropLastRecording()
    let completed = DispatchSemaphore(value: 0)
    let observed = Task.detached {
      await pending.task.value
      completed.signal()
    }
    // Deliberately occupy MainActor: work already cancelled must release its files without
    // queuing behind unrelated UI work. The saved task still includes every cleanup defer.
    let completedWithoutUI = occupyUIUntilSignalled(completed)
    let elapsed = requested.duration(to: .now)
    #expect(completedWithoutUI)
    print("recording-busy-ui completed=\(completedWithoutUI) latency-ms=\(milliseconds(elapsed))")
    // A regressed import admission must fail and unwind instead of hanging on the gated stub.
    if !completedWithoutUI { fixture.stub.stop() }
    await observed.value
    watching.cancel()
    #expect(sawSignal)
    #expect(await watching.value)
    #expect(old.value == nil)
    #expect(!fixture.exists(result.take.folder))
    #expect(fixture.controller.preparingAsks.isEmpty)
    #expect(fixture.stub.requests == 0)
  }

  private func occupyUIUntilSignalled(_ completed: DispatchSemaphore) -> Bool {
    completed.wait(timeout: .now() + 2) == .success
  }

  @Test("Stop while import admission waits for UI does not start a new import")
  func cancellationBeforeImportAdmission() async throws {
    let media = try await RecordingMediaFixture.make()
    defer { media.dispose() }
    let fixture = try await RecordingPreparationFixture.make()
    defer { fixture.dispose() }
    let result = try media.result(in: fixture.folder("import-admission"))
    let old = fixture.install(result)
    let pending = try fixture.ask()
    let exported = DispatchSemaphore(value: 0)
    let watching = Task.detached {
      defer { exported.signal() }
      let deadline = ContinuousClock.now + .seconds(2)
      while ContinuousClock.now < deadline {
        let folders =
          (try? FileManager.default.contentsOfDirectory(
            at: result.take.folder, includingPropertiesForKeys: nil)) ?? []
        for folder in folders where folder.lastPathComponent.hasPrefix("export-") {
          let files =
            (try? FileManager.default.contentsOfDirectory(
              at: folder, includingPropertiesForKeys: nil)) ?? []
          if files.contains(where: { $0.pathExtension == "md" }) { return true }
        }
        try? await Task.sleep(for: .milliseconds(1))
      }
      return false
    }
    let signalled = occupyUIUntilSignalled(exported)
    fixture.controller.stopAsk(pending.id)
    // If admission regresses, close the deliberately gated HTTP endpoint to fail the test
    // instead of hanging forever in the import that correctly shields cancellation.
    let watchdog = Task {
      try? await Task.sleep(for: .seconds(2))
      fixture.stub.stop()
    }
    await pending.task.value
    watchdog.cancel()
    await watchdog.value
    #expect(signalled)
    #expect(await watching.value)
    #expect(fixture.stub.requests == 0)
    #expect(fixture.controller.preparingAsks.isEmpty)
    #expect(
      try fixture.contents(of: result.take.folder).allSatisfy {
        !$0.lastPathComponent.hasPrefix("export-")
      })
    fixture.controller.dropLastRecording()
    #expect(old.value == nil)
    #expect(!fixture.exists(result.take.folder))
  }

  private nonisolated static func observeActiveExport(in folder: URL) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(2)
    while !Task.isCancelled, ContinuousClock.now < deadline {
      let exports =
        (try? FileManager.default.contentsOfDirectory(
          at: folder, includingPropertiesForKeys: nil)) ?? []
      for export in exports where export.lastPathComponent.hasPrefix("export-") {
        let files =
          (try? FileManager.default.contentsOfDirectory(
            at: export, includingPropertiesForKeys: nil)) ?? []
        // A completed export must fail this precondition, even if JPEG files are present.
        if files.contains(where: { $0.pathExtension == "md" }) { return false }
        if files.contains(where: { $0.pathExtension == "jpg" }) { return true }
      }
      try? await Task.sleep(for: .milliseconds(1))
    }
    return false
  }
}
