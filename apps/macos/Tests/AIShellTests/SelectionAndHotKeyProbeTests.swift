import AICore
import AppKit
import Carbon.HIToolbox
import Darwin
import Foundation
import Testing

@testable import AIShell

/// Minimal loopback HTTP server used by `DiagnosticsDoctorMergeAndBreadcrumbsTests` (`B8`).
nonisolated final class DelayedDoctorLoopbackServer: @unchecked Sendable {
  let port: UInt16
  private let listenFd: Int32
  private let acceptThread: Thread

  init(doctorDelayMs: UInt32, doctorBody: Data) throws {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { throw POSIXError(.EIO) }
    var yes: Int32 = 1
    _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let bound = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0, listen(fd, 8) == 0 else {
      close(fd)
      throw POSIXError(.EADDRINUSE)
    }

    var actual = sockaddr_in()
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &actual) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
    }
    self.listenFd = fd
    self.port = UInt16(bigEndian: actual.sin_port)

    let snapshotBody = Data(#"{"schemaVersion":1,"capturedAt":"2026-11-18T12:00:00.000Z"}"#.utf8)
    self.acceptThread = Thread {
      while true {
        let client = accept(fd, nil, nil)
        if client < 0 { break }
        Thread.detachNewThread {
          defer { close(client) }
          var noSigPipe: Int32 = 1
          _ = setsockopt(
            client, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
          var buf = [UInt8](repeating: 0, count: 4_096)
          let n = read(client, &buf, buf.count)
          guard n > 0 else { return }
          let reqText = String(decoding: buf.prefix(n), as: UTF8.self)
          let body: Data
          if reqText.contains("/v1/diagnostics/run") {
            usleep(doctorDelayMs * 1_000)
            body = doctorBody
          } else {
            body = snapshotBody
          }
          let header =
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
          var packet = Data(header.utf8)
          packet.append(body)
          _ = packet.withUnsafeBytes { raw in
            write(client, raw.baseAddress, raw.count)
          }
        }
      }
    }
    self.acceptThread.start()
  }

  func stop() {
    _ = Darwin.shutdown(listenFd, SHUT_RDWR)
    close(listenFd)
  }
}

@MainActor
@Suite("Selection probe activeAttempt/WPS cleanup & hotkey decision ring accuracy", .serialized)
struct SelectionAndHotKeyProbeTests {
  private static func sampleToolbarSettings(
    excluded: Set<String> = []
  ) -> SelectionToolbarSettings {
    SelectionToolbarSettings(
      enabled: true,
      activation: SelectionActivation(mode: .always, keys: []),
      showHud: false,
      smallIcon: .off,
      position: .above,
      excludedBundleIds: excluded,
      commands: [])
  }

  @Test(
    "performProbeAttempt(attemptIndex: 1) clears activeAttempt on context change & WPS timeout (B19)"
  )
  func selectionProbeClearsActiveAttemptAndEmitsWpsTimeoutOnAttempt1() async throws {
    let ring = SelectionDecisionRing()
    var secureNow = false
    var wpsSleepMs = 0
    let runner = SelectionToolbarProbeRunner(
      ring: ring,
      wpsEvidence: { _, _ in
        if wpsSleepMs > 0 {
          try? await Task.sleep(for: .milliseconds(wpsSleepMs))
        }
        return nil
      },
      secureInputEnabled: { secureNow },
      frontmostAppProvider: {
        .init(pid: 4242, bundleIdentifier: "com.apple.Safari", runningApp: nil)
      })

    var liveOutcomes: [String] = []
    runner.onLiveProbeStep = { step in liveOutcomes.append(step.gateOutcome) }
    let settings = Self.sampleToolbarSettings()

    // 1. Context-change early exit on attemptIndex == 1 (Secure Input turns on during debounce):
    let recorded1 = try #require(
      runner.recordMouseUp(
        .init(
          pointer: CGPoint(x: 100, y: 100), pressedAt: CGPoint(x: 50, y: 100), clickCount: 1,
          shiftHeld: false, mayHaveSelected: true, heldAtPress: false, heldAtRelease: false,
          listeningOn: false, admitted: true, settings: settings, trusted: true),
        token: 10))
    #expect(runner.hasActiveAttempt == true)

    secureNow = true
    let ctxOutcome = await runner.performProbeAttempt(
      attemptIndex: 1, slot: recorded1.slot, seq: recorded1.seq, origin: CGPoint(x: 50, y: 100),
      startedAt: Date().timeIntervalSince1970, token: 10, cellsOnly: false, settings: settings,
      trusted: true, isStillCurrent: { $0 == 4242 })
    #expect(ctxOutcome.shouldShow == false)
    #expect(runner.hasActiveAttempt == false)
    #expect(liveOutcomes.last == "secure_input_active")

    // Subsequent click/interruption with same token must NOT corrupt the completed ring entry!
    runner.recordInterruption(.mouseDown, currentToken: 10)
    let firstEntry = try #require(ring.snapshot().entries.first)
    #expect(firstEntry.dropStage == 4)
    #expect(firstEntry.debounceState == 3)
    #expect(liveOutcomes.last == "secure_input_active")

    // 2. WPS >= 300ms timeout on attemptIndex == 1 updates ring slot & emits terminal live step:
    secureNow = false
    wpsSleepMs = 330
    let recorded2 = try #require(
      runner.recordMouseUp(
        .init(
          pointer: CGPoint(x: 120, y: 120), pressedAt: CGPoint(x: 60, y: 120), clickCount: 1,
          shiftHeld: false, mayHaveSelected: true, heldAtPress: false, heldAtRelease: false,
          listeningOn: false, admitted: true, settings: settings, trusted: true),
        token: 11))
    #expect(runner.hasActiveAttempt == true)

    let wpsOutcome = await runner.performProbeAttempt(
      attemptIndex: 1, slot: recorded2.slot, seq: recorded2.seq, origin: CGPoint(x: 60, y: 120),
      startedAt: Date().timeIntervalSince1970, token: 11, cellsOnly: false, settings: settings,
      trusted: true, isStillCurrent: { $0 == 4242 })
    #expect(wpsOutcome.shouldShow == false)
    #expect(runner.hasActiveAttempt == false)
    #expect(liveOutcomes.last == "wps_probe_timeout")

    let secondEntry = try #require(ring.snapshot().entries.last)
    #expect(secondEntry.dropStage == 9)
    #expect(secondEntry.debounceState == 3)
    #expect(secondEntry.attempt1Outcome == 0)
  }

  @Test(
    "Recovered tap timeout & cancelled recording settle do not mark healthy hotkeys anomalous (B31)"
  )
  func hotKeyRingHealthyAfterRecoveredTapTimeoutAndCancelledResume() async throws {
    let ring = HotKeyDecisionRing()
    let registrar = HotKeyRegistrar(
      canWatchKeyboard: { false },
      decisionRing: ring,
      onPress: { _ in },
      onRelease: { _ in })

    // 1. Transient `.tapDisabledByTimeout` recovered via `reEnableTap` records 1 anomaly, then
    //    resets `tapDisabledCount` to 0 so subsequent shortcut presses are NOT anomalous.
    registrar.remoteModifiers.handleTapDisabled(.tapDisabledByTimeout, reEnableTap: { true })
    #expect(registrar.remoteModifiers.tapDisabledCount == 0)

    registrar.handleTriggeredPress("summon.toggle", isDoubleTap: false)
    let afterPress = ring.snapshot().entries
    #expect(afterPress.count == 2)
    #expect(afterPress[0].subjectOrBundleId.stringValue == "tap_disabled_timeout")
    #expect(afterPress[0].isAnomaly == true)
    #expect(afterPress[1].subjectOrBundleId.stringValue == "summon.toggle")
    #expect(afterPress[1].tapDisabledCount == 0)
    #expect(afterPress[1].isAnomaly == false)

    // Unrecovered `.tapDisabledByUserInput` resets cleanly on `stop()`.
    registrar.remoteModifiers.handleTapDisabled(.tapDisabledByUserInput)
    #expect(registrar.remoteModifiers.tapDisabledCount == 1)
    registrar.remoteModifiers.stop()
    #expect(registrar.remoteModifiers.tapDisabledCount == 0)

    // 2. Cancelling `resuming` via a second `startRecording` must NOT record `handoff_aborted`.
    final class DummyOwner {}
    let owner = DummyOwner()
    let oid = ObjectIdentifier(owner)
    registrar.startRecording(owner: oid, session: 1)
    _ = registrar.stopRecording(owner: oid, session: 1)
    // Immediately re-enter recording while `ShortcutRelease.waitForHandoff()` is in its 32ms settle.
    registrar.startRecording(owner: oid, session: 2)
    try await Task.sleep(for: .milliseconds(60))

    let subjects = ring.snapshot().entries.map(\.subjectOrBundleId.stringValue)
    #expect(!subjects.contains("handoff_aborted"))
  }
}
