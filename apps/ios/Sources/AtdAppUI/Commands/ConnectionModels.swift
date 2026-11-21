import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// A connection's page in the model picker: the models its provider lists, fetched with the
/// connection's key when the page opens, with the one in use marked. The connection's own model
/// and the chosen one stay on offer while the list loads or when it cannot be fetched.
struct ConnectionModels: View {
  let connection: ProviderConnection
  /// The model this command runs on when it is pinned to this connection.
  let chosen: String?
  let pick: (String) -> Void
  @Environment(AppStore.self) private var store
  @State private var listing = Listing.loading
  /// Bumped by 重试, which fetches the list again.
  @State private var attempt = 0
  @State private var filter = ""

  private enum Listing {
    case loading
    case loaded([ModelInfo])
    case failed(ModelFailure)
  }

  /// Longer lists (OpenRouter lists hundreds) get a field that narrows them.
  private static let filterThreshold = 12

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if models.count > Self.filterThreshold {
        HStack(spacing: 8) {
          Image(systemName: "magnifyingglass")
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
          TextField(AppText.string("model.filter"), text: $filter)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        .inkField()
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
      }
      InkList(inset: 62) {
        ForEach(shown) { info in
          // A display name leads, with the id under it; a bare id stands alone.
          let named = info.name.map { $0 != info.id } ?? false
          PickerRow(
            title: info.name ?? info.id, subtitle: named ? info.id : nil,
            selected: info.id == chosen
          ) {
            pick(info.id)
          }
        }
      }
      status
    }
    .padding(.top, 8)
    .task(id: attempt) { await load() }
  }

  /// While loading, a line that says so; after a failure, why, with 重试.
  @ViewBuilder private var status: some View {
    switch listing {
    case .loading:
      // A provider's list usually arrives at once; the line shows only when it doesn't.
      InkWaiting(AppText.string("model.loading"), delay: .milliseconds(400))
        .padding(.horizontal, 20)
        .frame(minHeight: 53)
    case .failed(let failure):
      VStack(alignment: .leading, spacing: 10) {
        Text(failure.message).foregroundStyle(.secondary)
        if failure.canRetry {
          Button {
            attempt += 1
          } label: {
            Label(AppText.string("action.retry"), systemImage: "arrow.counterclockwise")
          }
          .buttonStyle(InkButtonStyle())
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 12)
    case .loaded:
      EmptyView()
    }
  }

  /// The provider's list in its order, after the connection's own model and the chosen one when
  /// the list does not have them (or has not arrived).
  private var models: [ModelInfo] {
    let listed: [ModelInfo] = if case .loaded(let models) = listing { models } else { [] }
    var known: [ModelInfo] = []
    for id in [connection.model] + (chosen.map { [$0] } ?? [])
    where !listed.contains(where: { $0.id == id }) && !known.contains(where: { $0.id == id }) {
      known.append(ModelInfo(id: id))
    }
    return known + listed
  }

  private var shown: [ModelInfo] {
    let words = filter.trimmingCharacters(in: .whitespaces)
    guard !words.isEmpty else { return models }
    return models.filter {
      $0.id.localizedCaseInsensitiveContains(words)
        || ($0.name?.localizedCaseInsensitiveContains(words) ?? false)
    }
  }

  /// Lists the models the way the connection's editor does: OpenCode's come from its catalog at a
  /// route built from the preset, so the key never goes anywhere else.
  private func load() async {
    listing = .loading
    guard let key = store.key(for: connection.id), !key.isEmpty else {
      listing = .failed(.invalidKey)
      return
    }
    do {
      if let preset = ProviderPreset.preset(connection.presetID), preset.isOpenCode {
        listing = .loaded(try await preset.openCodeModels(key: key))
      } else {
        let endpoint = ProviderEndpoint(api: connection.api, baseURL: connection.baseURL, key: key)
        listing = .loaded(try await endpoint.models())
      }
    } catch let failure as ModelFailure {
      listing = .failed(failure)
    } catch {
      // Cancelled: the page closed.
    }
  }
}
