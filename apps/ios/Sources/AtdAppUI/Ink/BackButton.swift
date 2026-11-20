import AtdInk
import SwiftUI

/// The round ‹ that steps back within a sheet; `label` says where it goes.
struct BackButton: View {
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold))
    }
    .buttonStyle(InkButtonStyle(form: .round))
    .accessibilityLabel(label)
  }
}
