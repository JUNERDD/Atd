import SwiftUI
import UIKit

/// The system camera, for a photo to ask about. The photo goes only to this question; Atd does not
/// save it to the library.
struct CameraPicker: UIViewControllerRepresentable {
  /// The photo as JPEG data, or nil when the person cancelled.
  let onFinish: (Data?) -> Void

  static var isAvailable: Bool {
    UIImagePickerController.isSourceTypeAvailable(.camera)
  }

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator {
    Coordinator(onFinish: onFinish)
  }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate,
    UINavigationControllerDelegate
  {
    let onFinish: (Data?) -> Void

    init(onFinish: @escaping (Data?) -> Void) {
      self.onFinish = onFinish
    }

    func imagePickerController(
      _ picker: UIImagePickerController,
      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
      let image = info[.originalImage] as? UIImage
      onFinish(image?.jpegData(compressionQuality: 0.9))
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      onFinish(nil)
    }
  }
}
