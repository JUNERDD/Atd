import CoreGraphics
import Foundation

extension AnnotationStroke: Codable {
  private enum CodingKeys: String, CodingKey { case value }

  public init(from decoder: Decoder) throws {
    if let single = try? decoder.singleValueContainer(), let raw = try? single.decode(Double.self) {
      self.init(raw)
      return
    }
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(try c.decodeIfPresent(Double.self, forKey: .value) ?? Self.default.value)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(value, forKey: .value)
  }
}

extension AnnotationRGBA: Codable {
  private enum CodingKeys: String, CodingKey { case red, green, blue, alpha }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      red: try c.decode(Double.self, forKey: .red),
      green: try c.decode(Double.self, forKey: .green),
      blue: try c.decode(Double.self, forKey: .blue),
      alpha: try c.decodeIfPresent(Double.self, forKey: .alpha) ?? 1)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(red, forKey: .red)
    try c.encode(green, forKey: .green)
    try c.encode(blue, forKey: .blue)
    try c.encode(alpha, forKey: .alpha)
  }
}

extension AnnotationStyle: Codable {
  private enum CodingKeys: String, CodingKey {
    case color, stroke, textBackground, redaction, plate, ink, fontSize, fixedWidth
    case customColor, fillMode, cornerStyle, cornerRadius, arrowStyle, isDashed, textPlate
    case mosaicMode, spotlightShape, fontFamily
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let color = try c.decodeIfPresent(AnnotationColor.self, forKey: .color) ?? .red
    let stroke = try c.decodeIfPresent(AnnotationStroke.self, forKey: .stroke) ?? .default
    let textBackground = try c.decodeIfPresent(Bool.self, forKey: .textBackground) ?? false
    let redaction = try c.decodeIfPresent(AnnotationRedaction.self, forKey: .redaction) ?? .pixelate
    let plate = try c.decodeIfPresent(AnnotationRGBA.self, forKey: .plate)
    let ink = try c.decodeIfPresent(AnnotationRGBA.self, forKey: .ink)
    let fontSize = try c.decodeIfPresent(CGFloat.self, forKey: .fontSize)
    let fixedWidth = try c.decodeIfPresent(Bool.self, forKey: .fixedWidth) ?? false
    let customColor = try c.decodeIfPresent(AnnotationRGBA.self, forKey: .customColor)
    let fillMode = try c.decodeIfPresent(AnnotationFillMode.self, forKey: .fillMode) ?? .outline
    let cornerStyle =
      try c.decodeIfPresent(AnnotationCornerStyle.self, forKey: .cornerStyle) ?? .sharp
    let cornerRadius = try c.decodeIfPresent(CGFloat.self, forKey: .cornerRadius)
    let arrowStyle =
      try c.decodeIfPresent(AnnotationArrowStyle.self, forKey: .arrowStyle) ?? .tapered
    let isDashed = try c.decodeIfPresent(Bool.self, forKey: .isDashed) ?? false
    let textPlate = try c.decodeIfPresent(AnnotationTextPlate.self, forKey: .textPlate)
    let mosaicMode =
      try c.decodeIfPresent(AnnotationMosaicMode.self, forKey: .mosaicMode) ?? .region
    let spotlightShape =
      try c.decodeIfPresent(AnnotationSpotlightShape.self, forKey: .spotlightShape) ?? .sharp
    let fontFamily = try c.decodeIfPresent(String.self, forKey: .fontFamily)
    self.init(
      color: color, stroke: stroke, textBackground: textBackground, redaction: redaction,
      plate: plate, ink: ink, fontSize: fontSize, fixedWidth: fixedWidth,
      customColor: customColor, fillMode: fillMode, cornerStyle: cornerStyle,
      arrowStyle: arrowStyle, isDashed: isDashed, textPlate: textPlate, mosaicMode: mosaicMode,
      spotlightShape: spotlightShape, fontFamily: fontFamily, cornerRadius: cornerRadius)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(color, forKey: .color)
    try c.encode(stroke, forKey: .stroke)
    try c.encode(textBackground, forKey: .textBackground)
    try c.encode(redaction, forKey: .redaction)
    try c.encodeIfPresent(plate, forKey: .plate)
    try c.encodeIfPresent(ink, forKey: .ink)
    try c.encodeIfPresent(fontSize, forKey: .fontSize)
    try c.encode(fixedWidth, forKey: .fixedWidth)
    try c.encodeIfPresent(customColor, forKey: .customColor)
    try c.encode(fillMode, forKey: .fillMode)
    try c.encode(cornerStyle, forKey: .cornerStyle)
    try c.encodeIfPresent(cornerRadius, forKey: .cornerRadius)
    try c.encode(arrowStyle, forKey: .arrowStyle)
    try c.encode(isDashed, forKey: .isDashed)
    try c.encode(textPlate, forKey: .textPlate)
    try c.encode(mosaicMode, forKey: .mosaicMode)
    try c.encode(spotlightShape, forKey: .spotlightShape)
    try c.encodeIfPresent(fontFamily, forKey: .fontFamily)
  }
}

extension AnnotationStyleChange: Codable {
  private enum CodingKeys: String, CodingKey {
    case color, stroke, textBackground, redaction, customColor, fillMode, cornerStyle
    case cornerRadius, arrowStyle, isDashed, textPlate, mosaicMode, spotlightShape, fontChoice
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let color = try c.decodeIfPresent(AnnotationColor.self, forKey: .color)
    let stroke = try c.decodeIfPresent(AnnotationStroke.self, forKey: .stroke)
    let textBackground = try c.decodeIfPresent(Bool.self, forKey: .textBackground)
    let redaction = try c.decodeIfPresent(AnnotationRedaction.self, forKey: .redaction)
    var customColor: AnnotationRGBA??
    if c.contains(.customColor) {
      customColor =
        (try c.decodeNil(forKey: .customColor))
        ? .some(nil) : .some(try c.decode(AnnotationRGBA.self, forKey: .customColor))
    }
    var cornerRadius: CGFloat??
    if c.contains(.cornerRadius) {
      cornerRadius =
        (try c.decodeNil(forKey: .cornerRadius))
        ? .some(nil) : .some(try c.decode(CGFloat.self, forKey: .cornerRadius))
    }
    self.init(
      color: color, stroke: stroke, textBackground: textBackground, redaction: redaction,
      customColor: customColor,
      fillMode: try c.decodeIfPresent(AnnotationFillMode.self, forKey: .fillMode),
      cornerStyle: try c.decodeIfPresent(AnnotationCornerStyle.self, forKey: .cornerStyle),
      arrowStyle: try c.decodeIfPresent(AnnotationArrowStyle.self, forKey: .arrowStyle),
      isDashed: try c.decodeIfPresent(Bool.self, forKey: .isDashed),
      textPlate: try c.decodeIfPresent(AnnotationTextPlate.self, forKey: .textPlate),
      mosaicMode: try c.decodeIfPresent(AnnotationMosaicMode.self, forKey: .mosaicMode),
      spotlightShape: try c.decodeIfPresent(AnnotationSpotlightShape.self, forKey: .spotlightShape),
      fontChoice: try c.decodeIfPresent(AnnotationFontChoice.self, forKey: .fontChoice),
      cornerRadius: cornerRadius)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeIfPresent(color, forKey: .color)
    try c.encodeIfPresent(stroke, forKey: .stroke)
    try c.encodeIfPresent(textBackground, forKey: .textBackground)
    try c.encodeIfPresent(redaction, forKey: .redaction)
    if let customColor {
      if let value = customColor {
        try c.encode(value, forKey: .customColor)
      } else {
        try c.encodeNil(forKey: .customColor)
      }
    }
    try c.encodeIfPresent(fillMode, forKey: .fillMode)
    try c.encodeIfPresent(cornerStyle, forKey: .cornerStyle)
    if let cornerRadius {
      if let value = cornerRadius {
        try c.encode(value, forKey: .cornerRadius)
      } else {
        try c.encodeNil(forKey: .cornerRadius)
      }
    }
    try c.encodeIfPresent(arrowStyle, forKey: .arrowStyle)
    try c.encodeIfPresent(isDashed, forKey: .isDashed)
    try c.encodeIfPresent(textPlate, forKey: .textPlate)
    try c.encodeIfPresent(mosaicMode, forKey: .mosaicMode)
    try c.encodeIfPresent(spotlightShape, forKey: .spotlightShape)
    try c.encodeIfPresent(fontChoice, forKey: .fontChoice)
  }
}

extension AnnotationShape: Codable {
  private enum Kind: String, Codable {
    case rectangle, ellipse, arrow, line, pen, highlighter, text, mosaic, mosaicBrush, step,
      spotlight
  }

  private enum CodingKeys: String, CodingKey {
    case kind, rect, from, to, bend, points, text, frame, center, tip
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .kind) {
    case .rectangle:
      self = .rectangle(try c.decode(CGRect.self, forKey: .rect))
    case .ellipse:
      self = .ellipse(try c.decode(CGRect.self, forKey: .rect))
    case .arrow:
      self = .arrow(
        from: try c.decode(CGPoint.self, forKey: .from),
        to: try c.decode(CGPoint.self, forKey: .to),
        bend: try c.decodeIfPresent(CGPoint.self, forKey: .bend))
    case .line:
      self = .line(
        from: try c.decode(CGPoint.self, forKey: .from),
        to: try c.decode(CGPoint.self, forKey: .to),
        bend: try c.decodeIfPresent(CGPoint.self, forKey: .bend))
    case .pen:
      self = .pen(try c.decode([CGPoint].self, forKey: .points))
    case .highlighter:
      self = .highlighter(try c.decode([CGPoint].self, forKey: .points))
    case .text:
      self = .text(
        try c.decode(String.self, forKey: .text),
        frame: try c.decode(CGRect.self, forKey: .frame))
    case .mosaic:
      self = .mosaic(try c.decode(CGRect.self, forKey: .rect))
    case .mosaicBrush:
      self = .mosaicBrush(try c.decode([CGPoint].self, forKey: .points))
    case .step:
      self = .step(
        center: try c.decode(CGPoint.self, forKey: .center),
        tip: try c.decodeIfPresent(CGPoint.self, forKey: .tip))
    case .spotlight:
      self = .spotlight(try c.decode(CGRect.self, forKey: .rect))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .rectangle(let rect):
      try c.encode(Kind.rectangle, forKey: .kind)
      try c.encode(rect, forKey: .rect)
    case .ellipse(let rect):
      try c.encode(Kind.ellipse, forKey: .kind)
      try c.encode(rect, forKey: .rect)
    case .arrow(let from, let to, let bend):
      try c.encode(Kind.arrow, forKey: .kind)
      try c.encode(from, forKey: .from)
      try c.encode(to, forKey: .to)
      try c.encodeIfPresent(bend, forKey: .bend)
    case .line(let from, let to, let bend):
      try c.encode(Kind.line, forKey: .kind)
      try c.encode(from, forKey: .from)
      try c.encode(to, forKey: .to)
      try c.encodeIfPresent(bend, forKey: .bend)
    case .pen(let points):
      try c.encode(Kind.pen, forKey: .kind)
      try c.encode(points, forKey: .points)
    case .highlighter(let points):
      try c.encode(Kind.highlighter, forKey: .kind)
      try c.encode(points, forKey: .points)
    case .text(let text, let frame):
      try c.encode(Kind.text, forKey: .kind)
      try c.encode(text, forKey: .text)
      try c.encode(frame, forKey: .frame)
    case .mosaic(let rect):
      try c.encode(Kind.mosaic, forKey: .kind)
      try c.encode(rect, forKey: .rect)
    case .mosaicBrush(let points):
      try c.encode(Kind.mosaicBrush, forKey: .kind)
      try c.encode(points, forKey: .points)
    case .step(let center, let tip):
      try c.encode(Kind.step, forKey: .kind)
      try c.encode(center, forKey: .center)
      try c.encodeIfPresent(tip, forKey: .tip)
    case .spotlight(let rect):
      try c.encode(Kind.spotlight, forKey: .kind)
      try c.encode(rect, forKey: .rect)
    }
  }
}

extension Annotation: Codable {
  private enum CodingKeys: String, CodingKey { case id, shape, style }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      id: try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID(),
      shape: try c.decode(AnnotationShape.self, forKey: .shape),
      style: try c.decodeIfPresent(AnnotationStyle.self, forKey: .style) ?? AnnotationStyle())
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(shape, forKey: .shape)
    try c.encode(style, forKey: .style)
  }
}

extension AnnotationDocument: Codable {
  private enum CodingKeys: String, CodingKey {
    case annotations, spotlightDim, stepFormat, stepStartIndex
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      try c.decodeIfPresent([Annotation].self, forKey: .annotations) ?? [],
      spotlightDim: try c.decodeIfPresent(CGFloat.self, forKey: .spotlightDim) ?? 0.50,
      stepFormat: try c.decodeIfPresent(AnnotationStepFormat.self, forKey: .stepFormat) ?? .numbers,
      stepStartIndex: try c.decodeIfPresent(Int.self, forKey: .stepStartIndex) ?? 1)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(annotations, forKey: .annotations)
    try c.encode(spotlightDim, forKey: .spotlightDim)
    try c.encode(stepFormat, forKey: .stepFormat)
    try c.encode(stepStartIndex, forKey: .stepStartIndex)
  }
}
