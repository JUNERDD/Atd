import AICore
import AIRelay
import Foundation

/// Add-ons in the shell: the service installs them, the shell reads which are
/// active and runs their executables. Today the only consumers are the computer engines.
extension ShellController {
  /// Reads the add-ons each time the control stream connects and on every `addons`
  /// invalidation, and hands the computer engines their executables when the installs change:
  /// an engine whose add-on went away or moved stops, one that arrived starts on the next
  /// request, and `computer.hello` publishes the profiles of the installed ones.
  func startAddons() {
    let catalog = AddonCatalog(services: services)
    catalog.onChange = { [weak self] installs in
      guard let computer = self?.computer else { return }
      Task { await computer.installEngines(.current(addons: installs)) }
    }
    control.onAddonsChanged = { catalog.refresh() }
  }
}
