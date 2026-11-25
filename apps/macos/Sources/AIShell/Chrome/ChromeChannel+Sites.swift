import AIChromeChannelKit
import AICore
import Foundation

/// The per-site permission switch (D6): one persistent chrome binding per paired profile and
/// origin, which the service keeps. The channel mirrors them from the service's listing, so every
/// connected extension shows its sites, Settings counts them, and an `ask` names the site's binding.
extension ChromeChannel {
  /// Lists the chrome bindings again and tells every connected extension its sites. Reconciles
  /// with the pairings first: a binding of a profile this shell has no pairing for (disconnected
  /// while the service was away, or paired with another build) is deleted, unless the pairings
  /// could not be read this launch.
  func refreshSites() async {
    guard let client = try? await environment.client(),
      let bindings = try? await client.computerBindings()
    else { return }
    var chrome = bindings.compactMap { binding -> TargetBindingWire.Browser? in
      guard case .browser(let browser) = binding, browser.channel == .chrome else { return nil }
      return browser
    }
    if let store, !store.unreadable {
      let orphans = chrome.filter { store.pairing($0.profileId) == nil }
      for orphan in orphans {
        do {
          try await client.deleteComputerBinding(id: orphan.bindingId)
        } catch {
          Self.log.error("An unpaired Chrome's site binding could not be deleted.")
        }
      }
      chrome.removeAll { store.pairing($0.profileId) == nil }
    }
    let changed = chrome != siteBindings
    siteBindings = chrome
    guard changed else { return }
    for link in links.links.values {
      link.send(.sites(origins: sites(of: link.installationId)))
    }
    environment.onStateChange()
  }

  /// `site.set`: the person turned a site's switch on (their consent; the service saves the
  /// site's binding with access) or off (the binding and what used it go).
  func setSite(origin: String, allowed: Bool, link: ChromeLink) async {
    guard BrowserOrigins.normalized(origin: origin) == origin else {
      link.send(.error(ref: origin, code: "invalidOrigin", message: "Not a site origin."))
      return link.send(.sites(origins: sites(of: link.installationId)))
    }
    do {
      let client = try await environment.client()
      if allowed {
        _ = try await client.saveChromeSite(installationId: link.installationId, origin: origin)
      } else {
        for site in siteBindings
        where site.profileId == link.installationId && site.allowedOrigins == [origin] {
          try await client.deleteComputerBinding(id: site.bindingId)
        }
      }
    } catch {
      Self.log.error("A Chrome site switch could not be saved.")
      link.send(.error(ref: origin, code: "siteFailed", message: "Atd could not save the site."))
    }
    await refreshSites()
    // The extension's switch follows the service, also when nothing changed or saving failed.
    link.send(.sites(origins: sites(of: link.installationId)))
  }

  /// Deletes every chrome binding of `installationId` the service lists (a disconnect, or a new
  /// pairing of the same id), then lists the sites again.
  func deleteSites(of installationId: String) async {
    guard let client = try? await environment.client() else { return }
    let listed = (try? await client.computerBindings()) ?? []
    for binding in listed {
      guard case .browser(let browser) = binding, browser.channel == .chrome,
        browser.profileId == installationId
      else { continue }
      do {
        try await client.deleteComputerBinding(id: browser.bindingId)
      } catch {
        Self.log.error("A Chrome site binding could not be deleted.")
      }
    }
    await refreshSites()
  }

  /// The site binding a run from `url` on `link` may act on, when the person allowed the site.
  func siteBinding(for url: String, on link: ChromeLink) -> TargetBindingWire.Browser? {
    siteBindings.first {
      $0.profileId == link.installationId && BrowserOrigins.allows(url, origins: $0.allowedOrigins)
    }
  }
}
