import Foundation

/// Shared container and privacy-safe JSON export projections for the 4 native decision rings.
///
/// Total steady-state ring payload across all 4 buffers is `26,112` bytes (`< 28 KiB < 32 KiB`).
/// Exported bundle JSON automatically anonymizes non-allowlisted `frontmostBundleId` values via
/// ``BundleIdentifierRedactor`` and scrubs inline detail strings via ``DiagnosticsScrubber``.
public final class ShellDecisionRings: Sendable {
  public let selection: SelectionDecisionRing
  public let hotkeys: HotKeyDecisionRing
  public let captureArbiter: CaptureAndArbiterRing
  public let relaySupervisor: RelayAndSupervisorRing
  public let anchor: MonotonicTimestampAnchor

  public init(
    capacity: Int = 64,
    anchor: MonotonicTimestampAnchor = .shared
  ) {
    self.selection = SelectionDecisionRing(capacity: capacity)
    self.hotkeys = HotKeyDecisionRing(capacity: capacity)
    self.captureArbiter = CaptureAndArbiterRing(capacity: capacity)
    self.relaySupervisor = RelayAndSupervisorRing(capacity: capacity)
    self.anchor = anchor
  }

  public func exportSelectionJSON() throws -> Data {
    let snap = selection.snapshot()
    let items = snap.entries.map { entry in
      ExportedSelectionEntry(
        seq: entry.seq,
        ts: anchor.iso8601String(forUptimeNs: entry.uptimeNs),
        frontmostBundleId: BundleIdentifierRedactor.redact(entry.frontmostBundleId.stringValue),
        frontmostPid: entry.frontmostPid,
        flags: entry.flags,
        dragDistanceDeciPt: entry.dragDistanceDeciPt,
        clickCount: entry.clickCount,
        activationMode: entry.activationMode,
        appFilter: entry.appFilter,
        attempt0Outcome: entry.attempt0Outcome,
        attempt0Role: entry.attempt0Role,
        attempt0WebAttrs: entry.attempt0WebAttrs,
        attempt0AxError: entry.attempt0AxError,
        attempt0ElapsedUs: entry.attempt0ElapsedUs,
        debounceState: entry.debounceState,
        interruptedBy: entry.interruptedBy,
        interruptedAfterMs: entry.interruptedAfterMs,
        attempt1Outcome: entry.attempt1Outcome,
        attempt1AxError: entry.attempt1AxError,
        attempt1ElapsedUs: entry.attempt1ElapsedUs,
        selectionLengthBucket: entry.selectionLengthBucket,
        dropStage: entry.dropStage)
    }
    return try Self.encodeRingFile(ringId: "selection", snapshot: snap, entries: items)
  }

  public func exportHotKeysJSON() throws -> Data {
    let snap = hotkeys.snapshot()
    let items = snap.entries.map { entry in
      let rawSubject = entry.subjectOrBundleId.stringValue
      let safeSubject =
        entry.subjectIsBundleId
        ? BundleIdentifierRedactor.redact(rawSubject)
        : (rawSubject.isEmpty
          ? nil : DiagnosticsScrubber.scrubInlineSummary(rawSubject, maxUTF8Bytes: 64))
      return ExportedHotKeyEntry(
        seq: entry.seq,
        ts: anchor.iso8601String(forUptimeNs: entry.uptimeNs),
        subject: safeSubject,
        frontmostPid: entry.frontmostPid,
        modifierFlagsMask: entry.modifierFlagsMask,
        elapsedMs: entry.elapsedMs,
        tapDisabledCount: entry.tapDisabledCount,
        eventKind: entry.eventKind,
        outcome: entry.outcome,
        flags: entry.flags)
    }
    return try Self.encodeRingFile(ringId: "hotkeys", snapshot: snap, entries: items)
  }

  public func exportCaptureArbiterJSON(heldClaims: [String] = []) throws -> Data {
    let snap = captureArbiter.snapshot()
    let items = snap.entries.map { entry in
      ExportedCaptureEntry(
        seq: entry.seq,
        ts: anchor.iso8601String(forUptimeNs: entry.uptimeNs),
        ownerSummary: DiagnosticsScrubber.scrubInlineSummary(
          entry.ownerSummary.stringValue, maxUTF8Bytes: 64),
        heldDurationMs: entry.heldDurationMs,
        errorCode: entry.errorCode,
        freezeMs: entry.freezeMs,
        widthPx: entry.widthPx,
        heightPx: entry.heightPx,
        eventKind: entry.eventKind,
        outcome: entry.outcome,
        resourceMask: entry.resourceMask,
        displayCount: entry.displayCount,
        unmatchedDisplayCount: entry.unmatchedDisplayCount,
        flags: entry.flags)
    }
    let scrubbedClaims = heldClaims.prefix(16).map {
      DiagnosticsScrubber.scrubInlineSummary($0, maxUTF8Bytes: 64)
    }
    return try Self.encodeRingFile(
      ringId: "capture_arbiter", snapshot: snap, heldClaims: scrubbedClaims, entries: items)
  }

  public func exportRelaySupervisorJSON() throws -> Data {
    let snap = relaySupervisor.snapshot()
    let items = snap.entries.map { entry in
      ExportedRelayEntry(
        seq: entry.seq,
        ts: anchor.iso8601String(forUptimeNs: entry.uptimeNs),
        detail: DiagnosticsScrubber.scrubInlineSummary(entry.detail.stringValue, maxUTF8Bytes: 120),
        pid: entry.pid,
        epoch: entry.epoch,
        terminationStatus: entry.terminationStatus,
        httpOrWsCode: entry.httpOrWsCode,
        crashCount: entry.crashCount,
        subsystem: entry.subsystem,
        eventKind: entry.eventKind,
        outcome: entry.outcome,
        flags: entry.flags)
    }
    return try Self.encodeRingFile(ringId: "relay_supervisor", snapshot: snap, entries: items)
  }

  private static func encodeRingFile<RawEntry: SequencedDecisionEntry, Projected: Encodable>(
    ringId: String,
    snapshot: DecisionRingSnapshot<RawEntry>,
    heldClaims: [String]? = nil,
    entries: [Projected]
  ) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(
      RingExportEnvelope(
        ringId: ringId,
        capacity: snapshot.capacity,
        totalRecorded: snapshot.totalRecorded,
        droppedCount: snapshot.overwrittenCount,
        heldClaims: heldClaims,
        entries: entries))
  }
}

private struct RingExportEnvelope<Item: Encodable>: Encodable {
  let ringId: String
  let capacity: Int
  let totalRecorded: UInt64
  let droppedCount: UInt64
  let heldClaims: [String]?
  let entries: [Item]
}

private struct ExportedSelectionEntry: Encodable {
  let seq: UInt32
  let ts: String
  let frontmostBundleId: String?
  let frontmostPid: Int32
  let flags: UInt64
  let dragDistanceDeciPt: UInt16
  let clickCount: UInt8
  let activationMode: UInt8
  let appFilter: UInt8
  let attempt0Outcome: UInt8
  let attempt0Role: UInt8
  let attempt0WebAttrs: UInt8
  let attempt0AxError: Int16
  let attempt0ElapsedUs: UInt16
  let debounceState: UInt8
  let interruptedBy: UInt8
  let interruptedAfterMs: UInt16
  let attempt1Outcome: UInt8
  let attempt1AxError: Int16
  let attempt1ElapsedUs: UInt16
  let selectionLengthBucket: UInt8
  let dropStage: UInt8
}

private struct ExportedHotKeyEntry: Encodable {
  let seq: UInt32
  let ts: String
  let subject: String?
  let frontmostPid: Int32
  let modifierFlagsMask: UInt32
  let elapsedMs: UInt16
  let tapDisabledCount: UInt16
  let eventKind: UInt8
  let outcome: UInt8
  let flags: UInt8
}

private struct ExportedCaptureEntry: Encodable {
  let seq: UInt32
  let ts: String
  let ownerSummary: String
  let heldDurationMs: UInt32
  let errorCode: Int32
  let freezeMs: UInt16
  let widthPx: UInt16
  let heightPx: UInt16
  let eventKind: UInt8
  let outcome: UInt8
  let resourceMask: UInt8
  let displayCount: UInt8
  let unmatchedDisplayCount: UInt8
  let flags: UInt8
}

private struct ExportedRelayEntry: Encodable {
  let seq: UInt32
  let ts: String
  let detail: String
  let pid: Int32
  let epoch: Int32
  let terminationStatus: Int32
  let httpOrWsCode: UInt16
  let crashCount: UInt16
  let subsystem: UInt8
  let eventKind: UInt8
  let outcome: UInt8
  let flags: UInt8
}
