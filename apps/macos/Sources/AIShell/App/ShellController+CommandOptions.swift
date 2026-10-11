import AICore

/// `commandOptions.set`: the commands whose options the shell offers, which the panel's page
/// pushes whole whenever they change (``CommandOptionsCatalog``).
extension ShellController {
  /// Replaces the catalog ``commandOptions`` holds and the selection toolbar's.
  func applyCommandOptions(_ catalog: CommandOptionsCatalog) {
    commandOptions = catalog
    toolbar.setCommandOptions(catalog)
  }
}
