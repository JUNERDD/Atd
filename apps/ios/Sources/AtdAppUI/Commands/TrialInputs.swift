import AtdAI
import AtdActions
import AtdInk
import PhotosUI
import SwiftUI

/// The photo a trial sends, and whether it is the built-in's sample or one the person picked.
struct TrialPhoto: Equatable {
  let image: ModelImage
  let isSample: Bool
}

/// The photo a trial of a command that reads one sends: the built-in's sample until the person
/// picks one of their own. The system photo picker needs no library access, and Atd gets only
/// the photo picked, prepared as every photo a model gets.
struct TrialPhotoInput: View {
  @Binding var photo: TrialPhoto?
  @State private var item: PhotosPickerItem?
  @State private var picture: UIImage?
  @ScaledMetric(relativeTo: .body) private var height: CGFloat = 180

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let picture {
        Image(uiImage: picture)
          .resizable()
          .scaledToFit()
          .frame(maxHeight: min(height, 320), alignment: .leading)
          .clipShape(InkShape(corners: .chip, wobble: 0))
          // A photo of white paper (a receipt, a screenshot) keeps an edge on the paper.
          .overlay { InkShape(corners: .chip, wobble: 0).stroke(InkColor.cardLine, lineWidth: 1) }
          .accessibilityElement()
          .accessibilityLabel(
            photo?.isSample == true
              ? AppText.string("trial.photo.sample") : AppText.string("trial.photo.own"))
      }
      // The picker's label is built off the main actor, so its title is read here.
      let title =
        photo == nil ? AppText.string("trial.photo.pick") : AppText.string("trial.photo.change")
      PhotosPicker(selection: $item, matching: .images) {
        Label(title, systemImage: "photo.on.rectangle")
      }
      .buttonStyle(InkButtonStyle())
    }
    .task(id: photo) {
      picture = photo.flatMap { UIImage(data: $0.image.data) }
    }
    .task(id: item) {
      guard let item, let data = try? await item.loadTransferable(type: Data.self),
        let image = await ImageEncoding.modelImage(from: data)
      else { return }
      photo = TrialPhoto(image: image, isSample: false)
    }
  }
}

/// What 今日简报 reads in a trial: today's events and reminders, with a line for each that Atd
/// may not read, since the run leaves it out. It never asks for access, and reads it again when
/// the person comes back from Settings.
struct TrialAgendaInput: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var calendar: DataAccess
  @State private var reminders: DataAccess

  init() {
    let reader = TodayReader()
    _calendar = State(initialValue: reader.access(to: .calendar))
    _reminders = State(initialValue: reader.access(to: .reminders))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(AppText.string("trial.agenda"))
      if calendar != .full {
        Text(AppText.string("trial.agenda.noCalendar")).foregroundStyle(.secondary)
      }
      if reminders != .full {
        Text(AppText.string("trial.agenda.noReminders")).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      let reader = TodayReader()
      calendar = reader.access(to: .calendar)
      reminders = reader.access(to: .reminders)
    }
  }
}
