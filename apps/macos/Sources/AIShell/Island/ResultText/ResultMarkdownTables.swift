import AppKit
import Markdown

/// A table, in a TextKit table: a cell is a paragraph in its table block, bordered in the
/// separator colour; the header row is in the semibold weight on the code fill; a column's
/// alignment aligns its cells. A cell spanning columns or rows keeps its span, and a row short of
/// cells is filled out with empty ones, so the grid stays whole as rows stream in.
extension ResultMarkdownRenderer {
  mutating func table(_ table: Markdown.Table, in scope: Scope, gap: CGFloat) {
    let columns = max(table.maxColumnCount, 1)
    let (textTable, ordinal) = blocks.next(
      kind: .table, indent: scope.indent, gap: gap, shape: [columns]
    ) {
      Self.textTable(columns: columns, indent: scope.indent, gap: gap)
    }
    let alignments = table.columnAlignments
    let rows = [Array(table.head.cells)] + table.body.rows.map { Array($0.cells) }
    for (row, cells) in rows.enumerated() {
      for column in 0..<columns {
        let cell = column < cells.count ? cells[column] : nil
        // A cell another one's span covers takes no place of its own.
        if let cell, cell.colspan == 0 || cell.rowspan == 0 { continue }
        let rowSpan = Int(cell?.rowspan ?? 1)
        let columnSpan = Int(cell?.colspan ?? 1)
        let block = blocks.cell(
          of: textTable, ordinal: ordinal, row: row, column: column, rows: rowSpan,
          columns: columnSpan
        ) {
          Self.cell(
            of: textTable, row: row, column: column, rows: rowSpan, columns: columnSpan,
            header: row == 0)
        }
        let traits = ResultMarkdownInlines.Traits(
          weight: row == 0 ? .semibold : .regular, color: scope.color)
        var text = cell.map { ResultMarkdownInlines.render($0, traits: traits) }
        // An empty cell still needs a character to hold its block.
        if text?.length ?? 0 == 0 {
          text = ResultMarkdownInlines.run(" ", traits)
        }
        var inner = scope
        inner.blocks.append(block)
        inner.indent = 0
        let alignment: NSTextAlignment =
          switch column < alignments.count ? alignments[column] : nil {
          case .left: .left
          case .center: .center
          case .right: .right
          case nil: .natural
          }
        emit(
          text ?? NSAttributedString(), font: style.font, in: inner, gap: 0, alignment: alignment)
      }
    }
  }

  private static func textTable(columns: Int, indent: CGFloat, gap: CGFloat) -> NSTextTable {
    let table = NSTextTable()
    table.numberOfColumns = columns
    table.layoutAlgorithm = .automaticLayoutAlgorithm
    table.collapsesBorders = false
    table.hidesEmptyCells = false
    table.setWidth(indent, type: .absoluteValueType, for: .margin, edge: .minX)
    table.setWidth(gap, type: .absoluteValueType, for: .margin, edge: .minY)
    return table
  }

  private static func cell(
    of table: NSTextTable, row: Int, column: Int, rows: Int, columns: Int, header: Bool
  ) -> NSTextTableBlock {
    let cell = NSTextTableBlock(
      table: table, startingRow: row, rowSpan: rows, startingColumn: column, columnSpan: columns)
    cell.setWidth(3, type: .absoluteValueType, for: .padding, edge: .minY)
    cell.setWidth(3, type: .absoluteValueType, for: .padding, edge: .maxY)
    cell.setWidth(6, type: .absoluteValueType, for: .padding, edge: .minX)
    cell.setWidth(6, type: .absoluteValueType, for: .padding, edge: .maxX)
    // Each line once: the separator colour is translucent, and a shared edge drawn by both of its
    // cells comes out darker.
    cell.setWidth(1, type: .absoluteValueType, for: .border, edge: .maxX)
    cell.setWidth(1, type: .absoluteValueType, for: .border, edge: .maxY)
    if column == 0 { cell.setWidth(1, type: .absoluteValueType, for: .border, edge: .minX) }
    if row == 0 { cell.setWidth(1, type: .absoluteValueType, for: .border, edge: .minY) }
    cell.setBorderColor(ResultTextStyle.rule)
    cell.verticalAlignment = .topAlignment
    if header { cell.backgroundColor = ResultTextStyle.codeFill }
    return cell
  }
}
