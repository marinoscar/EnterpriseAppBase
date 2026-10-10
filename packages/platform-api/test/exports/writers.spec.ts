import { Writable } from 'node:stream';

import { Workbook } from 'exceljs';
import { exportJsonFileSchema } from '@marinoscar/platform-contract/exports';

import { CSV_EXPORT_WRITER, JSON_EXPORT_WRITER, XLSX_EXPORT_WRITER, xlsxSheetName, type ExportTable } from '../../src/exports';
import { collectExportOutput, readZipEntries, tablesOf } from '../../src/exports/testing';

const COLUMNS: ExportTable['columns'] = [
  { key: 'id', label: 'Id', type: 'string' },
  { key: 'note', label: 'Note', type: 'string' },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'active', label: 'Active', type: 'boolean' },
];

function fixture() {
  return tablesOf([
    {
      dataset: 'notes',
      title: 'Notes',
      columns: COLUMNS,
      rows: [
        { id: 'a', note: '=HYPERLINK("http://evil")', amount: -5, active: true },
        { id: 'b', note: 'comma, "quote"\nnewline', amount: 1.5, active: false },
        { id: 'c', note: null, amount: null, active: null },
      ],
    },
    { dataset: 'empty', title: 'Empty / nothing', columns: [{ key: 'x', label: 'X', type: 'string' }], rows: [] },
  ]);
}

describe('export writers', () => {
  it('json: a versioned envelope that parses with the contract, rows in order, missing keys null', async () => {
    const { bytes, result } = await collectExportOutput(JSON_EXPORT_WRITER, fixture(), 'user-data');
    const file = exportJsonFileSchema.parse(JSON.parse(bytes.toString('utf8')));
    expect(file.schemaVersion).toBe(1);
    expect(file.source).toBe('user-data');
    expect(Object.keys(file.datasets)).toEqual(['notes', 'empty']);
    expect(file.datasets.notes!.rows).toEqual([
      { id: 'a', note: '=HYPERLINK("http://evil")', amount: -5, active: true },
      { id: 'b', note: 'comma, "quote"\nnewline', amount: 1.5, active: false },
      { id: 'c', note: null, amount: null, active: null },
    ]);
    expect(file.datasets.empty!.rows).toEqual([]);
    expect(result.rowCounts).toEqual({ notes: 3, empty: 0 });
  });

  it('csv: a zip of RFC 4180 files with a BOM, CRLF and neutralised formula cells', async () => {
    const { bytes, result } = await collectExportOutput(CSV_EXPORT_WRITER, fixture());
    const entries = readZipEntries(bytes);
    expect(entries.map((e) => e.name)).toEqual(['notes.csv', 'empty.csv']);
    const notes = entries[0]!.data.toString('utf8');
    expect(notes).toBe(
      '﻿id,note,amount,active\r\n' +
        `a,"'=HYPERLINK(""http://evil"")",-5,true\r\n` +
        'b,"comma, ""quote""\nnewline",1.5,false\r\n' +
        'c,,,\r\n',
    );
    expect(entries[1]!.data.toString('utf8')).toBe('﻿x\r\n');
    expect(result.rowCounts).toEqual({ notes: 3, empty: 0 });
  });

  it('xlsx: one sheet per dataset, a header of labels, typed cells', async () => {
    const { bytes, result } = await collectExportOutput(XLSX_EXPORT_WRITER, fixture());
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Notes', 'Empty - nothing']);
    const sheet = workbook.getWorksheet('Notes')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Id', 'Note', 'Amount', 'Active']);
    expect(sheet.getRow(2).getCell(2).value).toBe('=HYPERLINK("http://evil")');
    expect(sheet.getRow(2).getCell(3).value).toBe(-5);
    expect(sheet.getRow(2).getCell(4).value).toBe(true);
    expect(sheet.rowCount).toBe(4);
    expect(result.rowCounts).toEqual({ notes: 3, empty: 0 });
  });

  it('names sheets as Excel allows: forbidden characters replaced, 31 characters, unique', () => {
    const taken = new Set<string>();
    expect(xlsxSheetName('a/b:c', taken)).toBe('a-b-c');
    expect(xlsxSheetName('A/B:C', taken)).toBe('A-B-C (2)');
    expect(xlsxSheetName('x'.repeat(40), taken)).toHaveLength(31);
    expect(xlsxSheetName('', taken)).toBe('Sheet');
  });

  it.each([JSON_EXPORT_WRITER, CSV_EXPORT_WRITER, XLSX_EXPORT_WRITER])('$id: refuses a malformed or repeated dataset name', async (writer) => {
    await expect(
      collectExportOutput(writer, tablesOf([{ dataset: '../x', title: 'X', columns: COLUMNS, rows: [] }])),
    ).rejects.toThrow(/must match/);
    await expect(
      collectExportOutput(
        writer,
        tablesOf([
          { dataset: 'a', title: 'A', columns: COLUMNS, rows: [] },
          { dataset: 'a', title: 'A', columns: COLUMNS, rows: [] },
        ]),
      ),
    ).rejects.toThrow(/appears twice/);
  });

  it.each([JSON_EXPORT_WRITER, CSV_EXPORT_WRITER, XLSX_EXPORT_WRITER])('$id: a failing source rejects and destroys the destination', async (writer) => {
    const out = new Writable({ write: (_chunk, _enc, cb) => cb() });
    async function* broken(): AsyncGenerator<Record<string, null>> {
      yield { id: null };
      throw new Error('database went away');
    }
    const tables = tablesOf([{ dataset: 'a', title: 'A', columns: COLUMNS, rows: broken() }]);
    await expect(writer.write(tables, out, { source: 's', exportedAt: new Date(), appSlug: 'app' })).rejects.toThrow('database went away');
    expect(out.destroyed).toBe(true);
  });
});
