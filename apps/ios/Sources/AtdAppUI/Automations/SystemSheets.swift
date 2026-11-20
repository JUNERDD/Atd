import AtdAutomations
import ContactsUI
import MessageUI
import SwiftUI
import UIKit

/// The system's compose sheet with the step's message, presented by UIKit over the automation
/// while `draft` is set. Atd sends nothing itself: the person taps send in it, or cancels.
struct MessageComposer: UIViewControllerRepresentable {
  @Binding var draft: MessageDraft?
  let onFinish: (MessageResult) -> Void

  /// Whether this iPhone can send a message now (no SIM or iMessage: it cannot).
  static var canSend: Bool { MFMessageComposeViewController.canSendText() }

  func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

  func updateUIViewController(_ host: UIViewController, context: Context) {
    context.coordinator.parent = self
    guard let draft, host.presentedViewController == nil else { return }
    let compose = MFMessageComposeViewController()
    compose.recipients = draft.recipients.map(\.address)
    compose.body = draft.body
    compose.messageComposeDelegate = context.coordinator
    present(compose, from: host)
  }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
    var parent: MessageComposer

    init(parent: MessageComposer) {
      self.parent = parent
    }

    func messageComposeViewController(
      _ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult
    ) {
      controller.dismiss(animated: true)
      parent.draft = nil
      switch result {
      case .sent: parent.onFinish(.sent)
      case .failed: parent.onFinish(.failed)
      default: parent.onFinish(.cancelled)
      }
    }
  }
}

/// The system's contact picker, presented by UIKit while `isPresented`: the person picks a phone
/// number or an email address. It needs no access to Contacts; Atd sees only what is picked.
struct ContactPicker: UIViewControllerRepresentable {
  @Binding var isPresented: Bool
  let onPick: (MessageRecipient) -> Void

  func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

  func updateUIViewController(_ host: UIViewController, context: Context) {
    context.coordinator.parent = self
    guard isPresented, host.presentedViewController == nil else { return }
    let picker = CNContactPickerViewController()
    picker.delegate = context.coordinator
    picker.displayedPropertyKeys = [CNContactPhoneNumbersKey, CNContactEmailAddressesKey]
    picker.predicateForEnablingContact = NSPredicate(
      format: "phoneNumbers.@count > 0 OR emailAddresses.@count > 0")
    picker.predicateForSelectionOfProperty = NSPredicate(
      format: "key == %@ OR key == %@", CNContactPhoneNumbersKey, CNContactEmailAddressesKey)
    present(picker, from: host)
  }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  final class Coordinator: NSObject, CNContactPickerDelegate {
    var parent: ContactPicker

    init(parent: ContactPicker) {
      self.parent = parent
    }

    func contactPicker(
      _ picker: CNContactPickerViewController, didSelect property: CNContactProperty
    ) {
      parent.isPresented = false
      let address =
        (property.value as? CNPhoneNumber)?.stringValue ?? (property.value as? String) ?? ""
      guard !address.isEmpty else { return }
      let name = CNContactFormatter.string(from: property.contact, style: .fullName) ?? ""
      parent.onPick(MessageRecipient(name: name.isEmpty ? address : name, address: address))
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
      parent.isPresented = false
    }
  }
}

/// Presents `controller` from `host` on the next turn of the main queue, once the host is in a
/// window and not presenting anything, so a sheet still sliding in does not refuse it.
private func present(_ controller: UIViewController, from host: UIViewController) {
  DispatchQueue.main.async { [weak host] in
    guard let host, host.view.window != nil, host.presentedViewController == nil else { return }
    host.present(controller, animated: true)
  }
}
