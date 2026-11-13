/// The island is shared between the page's progress and the shell's own content (architecture
/// R7): its screen recording's and its long screenshot's, which take the one shell place in turn
/// (decision D13), so ``Recording`` and the calls below stand for whichever of them has it. The
/// recording's capsule, its processing and its discard confirmation hold the island: what the
/// page shows meanwhile is kept in ``CommandProgressState/shown`` without drawing. The shell's
/// results (a result card, a finished status) and the long screenshot's processing only yield
/// it: the page's next show replaces them.
///
/// What the page showed while the shell held the island draws as soon as the hold ends,
/// whether the shell goes on to a result (which that progress then replaces) or leaves:
/// a run, its options card, its notice or its answer card the person started meanwhile is not
/// kept waiting behind the result card. Notices and confirmations get their full lifetime
/// after they draw. What showed before the shell took the island (an answer card the person
/// moved on from) waits until the shell lets go.
extension CommandProgressState {
  public enum Recording: Equatable, Sendable {
    /// The recording's capsule, its processing or the discard confirmation: the page's progress
    /// waits.
    /// `arrived`: the page showed something meanwhile, which draws once the hold ends.
    case holding(arrived: Bool)
    /// A result: the page's next show takes the island from it.
    case yielding
  }

  /// What a show of the page's progress (or a command shortcut's press capsule) does now.
  public enum ProgressArrival: Equatable, Sendable {
    /// It draws: nothing of the shell is on the island.
    case draws
    /// It draws, replacing the shell's result, which is gone from the island.
    case replacesRecording
    /// It waits under the shell's content, which holds the island.
    case waits
  }

  /// The page's progress draws on the island: nothing of the shell is on it.
  public var drawsProgress: Bool { recording == nil }

  /// The shell's result yields the island: the page's next show replaces it.
  public var recordingYields: Bool { recording == .yielding }

  /// The shell puts its content on the island, holding it or yielding it. False when this
  /// ends a hold under which the page showed something: that progress takes the island instead,
  /// and the recording's content does not draw.
  public mutating func showRecording(holding: Bool) -> Bool {
    if case .holding(let arrived) = recording {
      if holding { return true }
      if arrived, shown != nil {
        recording = nil
        return false
      }
    }
    recording = holding ? .holding(arrived: false) : .yielding
    return true
  }

  /// The shell's content left the island: what the page shows draws again. True when what
  /// draws came while the shell held the island.
  @discardableResult
  public mutating func releaseRecording() -> Bool {
    let arrived = recording == .holding(arrived: true)
    recording = nil
    return arrived && shown != nil
  }

  /// The page's progress arrives: it waits under holding shell content, and replaces yielding
  /// content.
  public mutating func progressArrives() -> ProgressArrival {
    switch recording {
    case nil: return .draws
    case .holding:
      recording = .holding(arrived: true)
      return .waits
    case .yielding:
      recording = nil
      return .replacesRecording
    }
  }
}
