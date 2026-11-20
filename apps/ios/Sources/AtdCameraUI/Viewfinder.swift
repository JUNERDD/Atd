import SwiftUI

/// Atd's viewfinder, shown full screen by the app's camera and by the Lock Screen capture
/// extension.
///
/// Stub (F0a): a dark placeholder with the camera's name. WS-C replaces it with the live camera,
/// the command modes and the shutter.
public struct Viewfinder: View {
  public init() {}

  public var body: some View {
    VStack(spacing: 14) {
      Image(systemName: "camera.viewfinder")
        .font(.system(size: 56, weight: .light))
        .accessibilityHidden(true)
      Text(String(localized: "viewfinder.title", bundle: .module))
        .font(.title3.weight(.semibold))
        .accessibilityAddTraits(.isHeader)
    }
    .foregroundStyle(.white)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.black)
  }
}
