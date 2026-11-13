/// The two modes of one capture session: the overlay's 截图 | 录屏 switch (⌘1 / ⌘2) picks
/// between them at any time. The selection and its element/window targeting scope carry over;
/// choosing what to capture is independent of whether it becomes an image or a recording.
public enum CaptureMode: String, CaseIterable, Equatable, Sendable {
  case screenshot
  case record
}
