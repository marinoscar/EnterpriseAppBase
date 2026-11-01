import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findEmailTemplate } from '../../../src/email/templates';
import { EMAIL_SNAPSHOT_CASES, snapshotFixtureName } from './templates.snapshot.cases';
import { configureTestEmail } from '../support';

configureTestEmail();

// =============================================================================
// Every template, byte for byte (issue #737, PP-8.4)
// =============================================================================
//
// Renders each case of `templates.snapshot.cases.ts` and compares subject,
// HTML, text and headers with the fixture captured before the email module
// moved into `@marinoscar/platform-api/email`. A layout or theme change that
// alters one byte of a default message fails here.
//
// To (re)capture the fixtures deliberately: UPDATE_EMAIL_FIXTURES=1.
// =============================================================================

const FIXTURES = join(__dirname, '__fixtures__');
const UPDATE = process.env.UPDATE_EMAIL_FIXTURES === '1';

describe('email templates: byte-identical default output', () => {
  it.each(EMAIL_SNAPSHOT_CASES.map((c) => [snapshotFixtureName(c), c] as const))('%s', (_name, c) => {
    const template = findEmailTemplate(c.template);
    expect(template).toBeDefined();
    const rendered = template!(c.data as never);
    const actual = {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers ?? null,
    };
    const file = join(FIXTURES, snapshotFixtureName(c));

    if (UPDATE || !existsSync(file)) {
      if (!UPDATE) throw new Error(`missing fixture ${file}; run with UPDATE_EMAIL_FIXTURES=1 to capture it`);
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }

    const expected = JSON.parse(readFileSync(file, 'utf8')) as typeof actual;
    expect(actual.subject).toBe(expected.subject);
    expect(actual.html).toBe(expected.html);
    expect(actual.text).toBe(expected.text);
    expect(actual.headers).toEqual(expected.headers);
  });
});
