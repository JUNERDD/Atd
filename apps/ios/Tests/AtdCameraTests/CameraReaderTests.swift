import AtdAI
import CoreGraphics
import Foundation
import Testing

@testable import AtdAppUI

@Suite struct CameraReaderTests {
  @Test func aPhotoIsTurnedUprightAndScaledToTheReadingSize() throws {
    let sideways = try #require(CameraFixtures.image(lines: [], width: 4000, height: 3000))
    // The camera stores a portrait shot sideways and says to turn it right.
    let photo = try #require(CameraFixtures.jpeg(sideways, orientation: .right))
    let upright = try #require(CameraReader.upright(photo))
    #expect(upright.width == 1920)
    #expect(upright.height == CameraReader.maxPixels)
    #expect(CameraReader.upright(Data("not a photo".utf8)) == nil)
  }

  @Test func latinTextIsFoundAndNumberedInReadingOrder() async throws {
    let photo = try #require(
      CameraFixtures.photo(lines: ["GREEN TEA 300", "COFFEE 450", "EXIT GATE 3"]))
    let shot = try #require(await CameraReader.read(photo))
    let texts = shot.lines.map { $0.text.uppercased() }
    #expect(shot.lines.map(\.id) == Array(1...max(shot.lines.count, 1)))
    let tea = try #require(texts.firstIndex { $0.contains("GREEN TEA") })
    let coffee = try #require(texts.firstIndex { $0.contains("COFFEE") })
    let exit = try #require(texts.firstIndex { $0.contains("EXIT") })
    #expect(tea < coffee && coffee < exit)
    // Each line is where it was drawn: the first near the top, on the left.
    let bounds = shot.lines[tea].quad.bounds
    #expect(bounds.minY > 0.05 && bounds.maxY < 0.3)
    #expect(bounds.minX > 0.03 && bounds.minX < 0.12)
  }

  @Test func japaneseTextIsFound() async throws {
    let photo = try #require(CameraFixtures.photo(lines: ["居酒屋 ひなた", "やきとり 980円"]))
    let shot = try #require(await CameraReader.read(photo))
    #expect(shot.lines.contains { $0.text.contains("やきとり") })
    #expect(shot.lines.first?.text.contains("居酒屋") == true)
  }
}
