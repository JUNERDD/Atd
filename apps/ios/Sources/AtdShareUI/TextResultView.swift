import AtdAI
import AtdModel
import SwiftUI

/// A text result (缩短, 翻译, 润色, the person's own): its versions on a segmented control when
/// the command has them, the version on show as it streams in, and 拷贝.
struct TextResultView: View {
  let run: ShareRun

  var body: some View {
    List {
      if let axis = run.axis {
        Section {
          OptionPicker(option: axis, selection: run.choice, select: { run.select($0) })
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      }
      versionSection
    }
    .listSectionSpacing(.compact)
    .safeAreaBar(edge: .bottom) {
      ActionBar {
        CopyButton(copied: run.copied, kind: copyKind, action: run.copyResult)
          .disabled(!canCopy)
      }
    }
  }

  @ViewBuilder private var versionSection: some View {
    let version = run.version
    if let version, case .failed(let failure) = version.state {
      Section {
        FailureView(failure: failure, retry: run.retry)
      }
    } else if version?.text.trimmed.isEmpty != false {
      // Nothing has arrived yet.
      Section {
        HStack {
          Spacer()
          ProgressView()
          Spacer()
        }
        .padding(.vertical, 24)
      }
    } else {
      if let items = run.items {
        Section {
          ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            Label {
              Text(item).textSelection(.enabled)
            } icon: {
              Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundStyle(.secondary)
            }
          }
        } footer: {
          footer(version)
        }
      } else {
        Section {
          Text(version?.text.trimmed ?? "")
            .textSelection(.enabled)
            .lineSpacing(3)
        } footer: {
          footer(version)
        }
      }
    }
  }

  @ViewBuilder private func footer(_ version: ShareRun.TextVersion?) -> some View {
    if version?.state == .truncated { Text(ModelFailure.truncated.message) }
  }

  private var canCopy: Bool {
    guard let version = run.version else { return false }
    return (version.state == .finished || version.state == .truncated)
      && !version.text.trimmed.isEmpty
  }

  private var copyKind: CopyButton.Kind {
    run.command.id == BuiltinCommands.translateID ? .translation : .result
  }
}
