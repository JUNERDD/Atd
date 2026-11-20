import Foundation

/// The person's data an action needs permission for.
public enum ProtectedData: String, Sendable, CaseIterable {
  case calendar
  case reminders
}

/// What Atd may do with one kind of protected data.
public enum DataAccess: Sendable, Equatable {
  /// Atd has not asked yet; asking shows the system's prompt once.
  case notDetermined
  /// The person said no, or the device restricts it: only Settings can change it now.
  case denied
  /// Events only: Atd may add events but not read them, its own included.
  case writeOnly
  case full
}

/// Why an action did not happen, in the terms the interface acts on. Every writer and reader in
/// this module reports missing access as `denied`, and only as `denied`.
public enum ActionError: Error, Sendable, Equatable {
  /// Atd has no access, or less than it needs (write-only where it must read). The way on is
  /// Settings › Atd (去设置), since the system asks only once.
  case denied(ProtectedData)
  /// There is no calendar or reminders list to add to: the person has none, or none is the
  /// default (Settings › Calendar › Default Calendar).
  case noDefaultCalendar(ProtectedData)
  /// An expense of zero or less, or without a currency, which the ledger does not keep.
  case invalidExpense
}
