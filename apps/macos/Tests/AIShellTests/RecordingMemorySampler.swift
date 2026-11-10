import Darwin

nonisolated struct RecordingMemorySnapshot: Sendable {
  let residentBytes: UInt64
  let footprintBytes: UInt64

  static func read() throws -> Self {
    var info = task_vm_info_data_t()
    let capacity = MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.stride
    var count = mach_msg_type_number_t(capacity)
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: capacity) { buffer in
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), buffer, &count)
      }
    }
    guard result == KERN_SUCCESS else { throw RecordingMemoryError.queryFailed(result) }
    // The kernel may return an older layout; phys_footprint was added in revision 1.
    guard let offset = MemoryLayout<task_vm_info_data_t>.offset(of: \.phys_footprint),
      Int(count) * MemoryLayout<integer_t>.stride >= offset + MemoryLayout<mach_vm_size_t>.size
    else { throw RecordingMemoryError.incompleteReply(count) }
    return Self(
      residentBytes: UInt64(info.resident_size), footprintBytes: UInt64(info.phys_footprint))
  }

  fileprivate func including(_ other: Self) -> Self {
    Self(
      residentBytes: max(residentBytes, other.residentBytes),
      footprintBytes: max(footprintBytes, other.footprintBytes))
  }
}

/// Measures only this test process. Samples are observed peaks, not kernel lifetime high-water marks.
nonisolated final class RecordingMemorySampler: Sendable {
  struct Summary: Sendable {
    let baseline: RecordingMemorySnapshot
    // Each metric has its own maximum; the maxima need not occur in the same sample.
    let peak: RecordingMemorySnapshot
    let after: RecordingMemorySnapshot
    let sampleCount: Int
    let maxSampleGap: Duration
  }

  private let sampling: Task<Summary, any Error>

  init() throws {
    let baseline = try RecordingMemorySnapshot.read()
    let started = ContinuousClock.now
    // Detached sampling cannot inherit MainActor from a controller test. The task owns all
    // mutable statistics, so no lock or actor hop competes with the cancellation being measured.
    sampling = Task.detached(priority: .userInitiated) {
      var peak = baseline
      var sampleCount = 1
      var previous = started
      var maxSampleGap = Duration.zero
      while !Task.isCancelled {
        do {
          try await Task.sleep(for: .milliseconds(5))
        } catch is CancellationError {
          break
        }
        let sample = try RecordingMemorySnapshot.read()
        let now = ContinuousClock.now
        maxSampleGap = max(maxSampleGap, previous.duration(to: now))
        previous = now
        peak = peak.including(sample)
        sampleCount += 1
      }
      let after = try RecordingMemorySnapshot.read()
      maxSampleGap = max(maxSampleGap, previous.duration(to: ContinuousClock.now))
      return Summary(
        baseline: baseline, peak: peak.including(after), after: after,
        sampleCount: sampleCount + 1, maxSampleGap: maxSampleGap)
    }
  }

  deinit { sampling.cancel() }

  /// Await this after the measured work and its cleanup finish; no sampler remains on return.
  func finish() async throws -> Summary {
    sampling.cancel()
    return try await sampling.value
  }
}

private nonisolated enum RecordingMemoryError: Error {
  case queryFailed(kern_return_t)
  case incompleteReply(mach_msg_type_number_t)
}
