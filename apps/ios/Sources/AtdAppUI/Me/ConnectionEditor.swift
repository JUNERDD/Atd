import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// 添加模型, and a connection's own sheet: the provider, the person's key, the address of a custom
/// endpoint and the model. 测试 sends one short request through all of them. The key goes to the
/// Keychain and never leaves the phone except to that provider.
struct ConnectionEditor: View {
  /// The connection to change; nil adds one.
  let connection: ProviderConnection?
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var presetID: String
  @State private var key = ""
  @State private var selectedAPI: ProviderAPI
  @State private var effort: ReasoningEffort?
  @State private var address: String
  @State private var model: String
  @State private var models: [ModelInfo] = []
  @State private var check = Check.idle
  @State private var checking: Task<Void, Never>?
  @State private var listing: Task<Void, Never>?
  @State private var confirmingRemoval = false
  /// The key stored for the connection being changed, read once.
  @State private var storedKey: String?

  private enum Check: Equatable {
    case idle, running, works
    case failed(ModelFailure)
  }

  init(connection: ProviderConnection?) {
    self.connection = connection
    let preset = connection.map(\.presetID) ?? ProviderPreset.all()[0].id
    _presetID = State(initialValue: preset)
    _selectedAPI = State(initialValue: connection?.api ?? ProviderPreset.all()[0].api)
    _effort = State(initialValue: connection?.reasoningEffort)
    _address = State(
      initialValue: connection?.presetID == ProviderPreset.customID
        ? connection?.baseURL.absoluteString ?? "" : "")
    _model = State(
      initialValue: connection?.model ?? ProviderPreset.preset(preset)?.suggestedModel ?? "")
  }

  private var preset: ProviderPreset {
    ProviderPreset.preset(presetID) ?? ProviderPreset.all()[0]
  }

  /// The key to use: the one typed in, or the stored one of an existing connection.
  private var effectiveKey: String? {
    let typed = key.trimmingCharacters(in: .whitespacesAndNewlines)
    return typed.isEmpty ? storedKey : typed
  }

  private var baseURL: URL? {
    if let url = preset.openCodeURL(for: api) ?? preset.baseURL { return url }
    let typed = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: typed), url.scheme == "https" || url.scheme == "http",
      url.host() != nil
    else { return nil }
    return url
  }

  private var listedModel: ModelInfo? { models.first { $0.id == modelID } }

  private var api: ProviderAPI {
    if preset.isOpenCode {
      return listedModel?.api ?? (modelID == connection?.model ? connection?.api : nil)
        ?? preset.api
    }
    return selectedAPI
  }

  private var efforts: [ReasoningEffort] {
    if api == .anthropic { return [] }
    if let choices = listedModel?.efforts { return choices }
    if preset.isOpenCode {
      return modelID == connection?.model ? [connection?.reasoningEffort].compactMap { $0 } : []
    }
    if api == .openAIResponses {
      return [.minimal, .low, .medium, .high, .xhigh]
    }
    return []
  }

  private var endpoint: ProviderEndpoint? {
    guard let key = effectiveKey, let baseURL else { return nil }
    return ProviderEndpoint(
      api: api, baseURL: baseURL, key: key,
      effort: effort.flatMap { efforts.contains($0) ? $0 : nil })
  }

  private var modelID: String {
    model.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: connection?.name ?? AppText.string("models.add")) {
        CloseButton { dismiss() }
      } trailing: {
        Button(action: save) {
          Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .round))
        .disabled(endpoint == nil || modelID.isEmpty)
        .accessibilityLabel(AppText.string("action.save"))
      }
      ScrollView {
        form
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    .onAppear {
      storedKey = connection.flatMap { store.key(for: $0.id) }
      listModels()
    }
    .onDisappear {
      checking?.cancel()
      listing?.cancel()
    }
  }

  private var form: some View {
    VStack(alignment: .leading, spacing: 0) {
      if connection == nil {
        SectionHeader(AppText.string("connection.provider"))
        Picker(AppText.string("connection.provider"), selection: $presetID) {
          ForEach(ProviderPreset.all()) { preset in
            Text(preset.name).tag(preset.id)
          }
        }
        .pickerStyle(.menu)
        .tint(.primary)
        .padding(.horizontal, 10)
        .frame(minHeight: 44)
        .onChange(of: presetID) { _, id in
          guard let next = ProviderPreset.preset(id) else { return }
          key = ""
          selectedAPI = next.api
          model = next.suggestedModel ?? ""
          effort = nil
          models = []
          check = .idle
          listModels()
        }
      }

      if preset.id == ProviderPreset.customID {
        Picker(AppText.string("connection.protocol"), selection: $selectedAPI) {
          Text(verbatim: "Chat Completions").tag(ProviderAPI.openAICompatible)
          Text(verbatim: "Responses").tag(ProviderAPI.openAIResponses)
          Text(verbatim: "Anthropic Messages").tag(ProviderAPI.anthropic)
        }
        .padding(.horizontal, 16)
        .onChange(of: selectedAPI) { listModels() }
      }

      SectionHeader(AppText.string("connection.key"))
      SecureField(
        connection == nil
          ? AppText.string("connection.key.placeholder") : AppText.string("connection.key.saved"),
        text: $key
      )
      .keyboardType(.asciiCapable)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .inkField()
      .padding(.horizontal, 16)
      .padding(.top, 6)
      .onChange(of: key) { listModels() }

      if preset.baseURL == nil {
        SectionHeader(AppText.string("connection.address"))
        TextField("https://", text: $address)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .inkField()
          .padding(.horizontal, 16)
          .padding(.top, 6)
          .onChange(of: address) { listModels() }
      }

      SectionHeader(AppText.string("connection.model"))
      HStack(spacing: 8) {
        TextField(AppText.string("connection.model.placeholder"), text: $model)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.asciiCapable)
          .onChange(of: model) {
            effort = nil
            invalidateCheck()
          }
        if !models.isEmpty {
          Menu {
            ForEach(models) { info in
              Button(info.name ?? info.id) { model = info.id }
            }
          } label: {
            Image(systemName: "chevron.up.chevron.down")
              .frame(width: 44, height: 44)
          }
          .tint(.primary)
          .accessibilityLabel(AppText.string("connection.chooseModel"))
        }
      }
      .inkField()
      .padding(.horizontal, 16)
      .padding(.top, 6)

      if !efforts.isEmpty && !modelID.isEmpty {
        SectionHeader(AppText.string("connection.effort"))
        Picker(AppText.string("connection.effort"), selection: $effort) {
          Text(AppText.string("connection.effort.default")).tag(nil as ReasoningEffort?)
          ForEach(efforts, id: \.self) { level in
            Text(verbatim: level.rawValue).tag(Optional(level))
          }
        }
        .padding(.horizontal, 10)
        .onChange(of: effort) { invalidateCheck() }
      }

      VStack(alignment: .leading, spacing: 10) {
        Button(action: runCheck) {
          Label(AppText.string("connection.test"), systemImage: "bolt.horizontal")
        }
        .buttonStyle(InkButtonStyle(form: .block))
        .disabled(endpoint == nil || modelID.isEmpty || check == .running)
        checkLine
      }
      .padding(.horizontal, 16)
      .padding(.top, 28)

      if let connection {
        Button(AppText.string("connection.remove"), role: .destructive) {
          confirmingRemoval = true
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(.top, 20)
        .confirmationDialog(
          AppText.string("connection.remove.confirm \(connection.name)"),
          isPresented: $confirmingRemoval, titleVisibility: .visible
        ) {
          Button(AppText.string("connection.remove"), role: .destructive) {
            store.removeConnection(connection.id)
            dismiss()
          }
        }
      }
    }
    .padding(.bottom, 24)
  }

  @ViewBuilder private var checkLine: some View {
    switch check {
    case .idle:
      EmptyView()
    case .running:
      InkWaiting(AppText.string("connection.testing"))
    case .works:
      Label(AppText.string("connection.works"), systemImage: "checkmark.circle.fill")
        .foregroundStyle(Color(uiColor: .systemGreen))
    case .failed(let failure):
      Label(failure.message, systemImage: "exclamationmark.circle")
        .foregroundStyle(InkColor.alert)
    }
  }

  private func invalidateCheck() {
    checking?.cancel()
    check = .idle
  }

  /// Fetches the models the key can use, once the key and address are in, so one can be picked
  /// from a menu; a model id can always be typed instead.
  private func listModels() {
    invalidateCheck()
    listing?.cancel()
    guard let endpoint else {
      models = []
      return
    }
    listing = Task {
      // Wait for the typing to settle before asking the provider.
      try? await Task.sleep(for: .milliseconds(600))
      guard !Task.isCancelled else { return }
      let listed: [ModelInfo]
      if preset.isOpenCode {
        listed = (try? await preset.openCodeModels(key: endpoint.key)) ?? []
      } else {
        listed = (try? await endpoint.models()) ?? []
      }
      guard !Task.isCancelled else { return }
      models = listed
    }
  }

  private func runCheck() {
    guard let endpoint, !modelID.isEmpty else { return }
    check = .running
    let model = modelID
    checking = Task {
      do {
        try await endpoint.test(model: model)
        guard !Task.isCancelled else { return }
        check = .works
      } catch let failure as ModelFailure {
        guard !Task.isCancelled else { return }
        check = .failed(failure)
      } catch {
        guard !Task.isCancelled else { return }
        check = .idle
      }
    }
  }

  private func save() {
    guard let endpoint, !modelID.isEmpty else { return }
    let typedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
    let saved = ProviderConnection(
      id: connection?.id ?? UUID().uuidString, presetID: preset.id,
      name: connection?.name ?? preset.name, api: endpoint.api, baseURL: endpoint.baseURL,
      model: modelID,
      reasoningEffort: endpoint.effort)
    store.save(saved, key: typedKey.isEmpty ? nil : typedKey)
    if store.failure == nil { dismiss() }
  }
}
