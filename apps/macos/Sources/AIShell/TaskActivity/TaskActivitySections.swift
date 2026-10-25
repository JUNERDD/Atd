import Foundation

/// The card's order: runs that need the person, then live work, then ended runs not yet read.
/// Within a section the service's order stays, so a run only moves when its phase moves it.
enum TaskActivitySectionKind: CaseIterable, Hashable {
  case attention
  case live
  case ended
}

extension TaskActivityPhase {
  var section: TaskActivitySectionKind {
    switch self {
    case .waiting, .disconnected, .stopPending: .attention
    case .running, .stopping: .live
    case .stopped, .completed, .failed: .ended
    }
  }
}

/// One line of the card's list. Headers and rows share one sequence with stable identities, so
/// a run that changes section moves to its new place instead of leaving and arriving again.
enum TaskActivityListEntry: Identifiable {
  case header(TaskActivitySectionKind, count: Int, first: Bool)
  case row(TaskActivityItem)

  enum ID: Hashable {
    case header(TaskActivitySectionKind)
    case row(TaskActivityRunKey)
  }

  var id: ID {
    switch self {
    case .header(let kind, _, _): .header(kind)
    case .row(let item): .row(item.key)
    }
  }

  /// Every section present is named, so a run's place says what it asks of the person.
  static func arrange(_ items: [TaskActivityItem]) -> [Self] {
    let sections = TaskActivitySectionKind.allCases.compactMap { kind in
      let members = items.filter { $0.phase.section == kind }
      return members.isEmpty ? nil : (kind, members)
    }
    return sections.enumerated().flatMap { index, section in
      [Self.header(section.0, count: section.1.count, first: index == 0)]
        + section.1.map(Self.row)
    }
  }
}
