/// The shell's words for why the service's import refused a file, one short title per
/// ``ResourceImportFailureReason``; the file's name goes on its own line under it. The command
/// island's compose card shows the first refused file's; the panel's page words the same reasons
/// itself (`composer.importFailed` in the renderer's `panel.json`).
public enum AttachFailureStringKey: String, CaseIterable, ShellCatalogKey {
  case missing = "attachFailure.missing"
  case denied = "attachFailure.denied"
  case unreadable = "attachFailure.unreadable"
  case unsupported = "attachFailure.unsupported"
  case tooLarge = "attachFailure.tooLarge"
  case noSpace = "attachFailure.noSpace"

  public init(_ reason: ResourceImportFailureReason) {
    switch reason {
    case .missing: self = .missing
    case .denied: self = .denied
    case .unreadable: self = .unreadable
    case .unsupported: self = .unsupported
    case .tooLarge: self = .tooLarge
    case .noSpace: self = .noSpace
    }
  }
}
