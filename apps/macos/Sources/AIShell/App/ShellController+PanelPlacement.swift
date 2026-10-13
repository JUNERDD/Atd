import AICore

/// Where summons show the task panel (``PanelPlacement``): the settings page reads it in
/// `app.state` and changes it with `window.setPlacement`. The panel keeps it
/// (``PanelWindowController/placement``) and applies a change from the next summon.
extension ShellController {
  /// `app.state`'s `panelPlacement`.
  func panelPlacementState() -> AppStateResult.PanelPlacement {
    switch panel.placement {
    case .bottomRight: .bottomRight
    case .center: .center
    case .lastPosition: .lastPosition
    }
  }

  /// `window.setPlacement`: the setting as applied.
  func setPanelPlacement(_ placement: WindowSetPlacementParams.Placement)
    -> WindowSetPlacementResult
  {
    switch placement {
    case .bottomRight: panel.placement = .bottomRight
    case .center: panel.placement = .center
    case .lastPosition: panel.placement = .lastPosition
    }
    let applied: WindowSetPlacementResult.Placement =
      switch panel.placement {
      case .bottomRight: .bottomRight
      case .center: .center
      case .lastPosition: .lastPosition
      }
    return WindowSetPlacementResult(placement: applied)
  }
}
