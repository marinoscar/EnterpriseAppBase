import {
  datasetNameOf,
  datasetTitleOf,
  delegateNameOf,
  exportColumnsOf,
  isRedactedExportField,
  toExportCell,
} from '../../src/exports';
import { FIXTURE_DATAMODEL } from './support';

const model = (name: string) => FIXTURE_DATAMODEL.models.find((m) => m.name === name)!;

describe('export columns and redaction', () => {
  it.each(['secret', 'tokenHash', 'token_hash', 'password', 'hint', 'clientSecret', 'deviceCodeHash', 'linkTokenCiphertext', 'passwordSalt'])(
    'always redacts %s',
    (name) => {
      expect(isRedactedExportField(name)).toBe(true);
    },
  );

  it.each(['id', 'name', 'Hash', 'hashtag', 'tokenPrefix', 'secretary'])('keeps %s', (name) => {
    expect(isRedactedExportField(name)).toBe(false);
  });

  it('derives scalar and enum columns, never Bytes, relations, exportOmit or redacted names', () => {
    expect(exportColumnsOf(model('ApiToken')).map((c) => c.key)).toEqual(['id', 'userId', 'name', 'lastUsedAt']);
    expect(exportColumnsOf(model('Diary'), ['private'])).toEqual([
      { key: 'id', label: 'Id', type: 'string' },
      { key: 'userId', label: 'User id', type: 'string' },
      { key: 'body', label: 'Body', type: 'string' },
      { key: 'mood', label: 'Mood', type: 'string' },
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'size', label: 'Size', type: 'number' },
      { key: 'meta', label: 'Meta', type: 'string' },
    ]);
    expect(exportColumnsOf(model('User')).map((c) => c.key)).toEqual(['id', 'email', 'createdAt']);
  });

  it('names datasets after the model', () => {
    expect(datasetNameOf('PersonalAccessToken')).toBe('personal_access_token');
    expect(datasetNameOf('AiUsageEvent')).toBe('ai_usage_event');
    expect(datasetTitleOf('PersonalAccessToken')).toBe('Personal access token');
    expect(delegateNameOf('PersonalAccessToken')).toBe('personalAccessToken');
  });

  it('turns database values into cells', () => {
    const text = { key: 'x', label: 'X', type: 'string' } as const;
    const num = { key: 'x', label: 'X', type: 'number' } as const;
    expect(toExportCell(new Date('2026-01-02T03:04:05.000Z'), text)).toBe('2026-01-02T03:04:05.000Z');
    expect(toExportCell(BigInt(42), num)).toBe(42);
    expect(toExportCell(BigInt('9007199254740993'), num)).toBe('9007199254740993');
    expect(toExportCell({ a: 1 }, text)).toBe('{"a":1}');
    expect(toExportCell(['a'], text)).toBe('["a"]');
    expect(toExportCell({ toString: () => '1.25' }, num)).toBe(1.25);
    expect(toExportCell(null, text)).toBeNull();
    expect(toExportCell(undefined, text)).toBeNull();
    expect(toExportCell(true, { key: 'b', label: 'B', type: 'boolean' })).toBe(true);
  });
});
