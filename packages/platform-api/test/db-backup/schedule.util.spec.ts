import {
  CronIntervalTooShortError,
  DEFAULT_BACKUP_TIME_OF_DAY,
  InvalidCronExpressionError,
  InvalidTimezoneError,
  MAX_BACKUP_DAY_OF_MONTH,
  assertBackupCron,
  backupScheduleToCron,
  minimumCronIntervalMinutes,
  nextFireAt,
  parseBackupCron,
  parseCronExpression,
  parseTimeOfDay,
  previousFireBoundary,
} from '../../src/db-backup/schedule.util';

// =============================================================================
// Unit tests for the schedule translation and the boundary walk (#280)
// =============================================================================
//
// Two things are being pinned here, and they fail in completely different ways:
//
//   1. THE EXPRESSION SHAPE. Exactly one of the two day fields is ever
//      restricted, because implementations disagree about what a cron with
//      both means (Vixie ORs them, Quartz-descended parsers AND them). A
//      regression here produces a schedule that runs on the wrong days, or
//      never.
//   2. THE DST ARITHMETIC. "The same local time tomorrow" is 23 or 25 hours
//      across a transition, so the boundary functions are exercised against
//      both edges of America/New_York's - a zone chosen because it observes
//      one and because its transitions are at a well-known local time. A
//      regression here silently moves every backup by an hour, twice a year,
//      and #282 either takes two backups for one boundary or skips one.
//
// The instants below are written as UTC and asserted as UTC; the local times
// they correspond to are in the comments. That direction is deliberate - an
// assertion written in local time would pass for an implementation that
// ignored the timezone entirely.
// =============================================================================

const NEW_YORK = 'America/New_York';

describe('backupScheduleToCron', () => {
  it('leaves BOTH day fields alone for daily', () => {
    expect(backupScheduleToCron({ frequency: 'daily', timeOfDay: '02:00' })).toBe('0 2 * * *');
  });

  it('restricts only day-of-week for weekly', () => {
    // `*` in day-of-month: with both restricted, the same expression means two
    // different schedules in two different cron implementations.
    expect(
      backupScheduleToCron({ frequency: 'weekly', dayOfWeek: 3, dayOfMonth: 15, timeOfDay: '23:45' })
    ).toBe('45 23 * * 3');
  });

  it('restricts only day-of-month for monthly', () => {
    expect(
      backupScheduleToCron({ frequency: 'monthly', dayOfWeek: 3, dayOfMonth: 15, timeOfDay: '04:05' })
    ).toBe('5 4 15 * *');
  });

  describe('clamping', () => {
    it('caps day-of-month at 28, so a monthly backup never skips February', () => {
      expect(backupScheduleToCron({ frequency: 'monthly', dayOfMonth: 31, timeOfDay: '02:00' })).toBe(
        `0 2 ${MAX_BACKUP_DAY_OF_MONTH} * *`
      );
      expect(backupScheduleToCron({ frequency: 'monthly', dayOfMonth: 0, timeOfDay: '02:00' })).toBe(
        '0 2 1 * *'
      );
    });

    it('clamps day-of-week into 0-6', () => {
      expect(backupScheduleToCron({ frequency: 'weekly', dayOfWeek: 9, timeOfDay: '02:00' })).toBe(
        '0 2 * * 6'
      );
      expect(backupScheduleToCron({ frequency: 'weekly', dayOfWeek: -3, timeOfDay: '02:00' })).toBe(
        '0 2 * * 0'
      );
    });

    it('clamps an out-of-range time rather than throwing inside a cron tick', () => {
      // The write path already validates this; a value that got past it means
      // something upstream is broken, and a VALID expression an hour off beats
      // an exception that stops every backup from now on.
      expect(backupScheduleToCron({ frequency: 'daily', timeOfDay: '25:70' })).toBe('59 23 * * *');
    });

    it('falls back to the documented default when the time is not a time at all', () => {
      expect(backupScheduleToCron({ frequency: 'daily', timeOfDay: 'tuesday' })).toBe('0 2 * * *');
      expect(backupScheduleToCron({ frequency: 'daily' })).toBe('0 2 * * *');
      expect(parseTimeOfDay(undefined)).toEqual({ hour: 2, minute: 0 });
      expect(DEFAULT_BACKUP_TIME_OF_DAY).toBe('02:00');
    });

    it('never throws, whatever it is handed', () => {
      expect(() =>
        backupScheduleToCron({
          frequency: 'quarterly' as never,
          dayOfWeek: Number.NaN,
          dayOfMonth: Number.NaN,
          timeOfDay: '',
        })
      ).not.toThrow();
    });
  });
});

describe('parseCronExpression', () => {
  it('reads the subset this module emits', () => {
    expect(parseCronExpression('0 2 * * *')).toEqual({
      minute: 0,
      hour: 2,
      dayOfMonth: null,
      dayOfWeek: null,
    });
    expect(parseCronExpression('45 23 * * 3')).toEqual({
      minute: 45,
      hour: 23,
      dayOfMonth: null,
      dayOfWeek: 3,
    });
    expect(parseCronExpression('5 4 15 * *')).toEqual({
      minute: 5,
      hour: 4,
      dayOfMonth: 15,
      dayOfWeek: null,
    });
  });

  it('rejects an expression restricting BOTH day fields', () => {
    // The ambiguity itself. Rejecting is what keeps this parser from having to
    // pick a side that half the world would read the other way.
    expect(() => parseCronExpression('0 2 15 * 1')).toThrow(InvalidCronExpressionError);
  });

  it('rejects the syntax it does not implement, rather than approximating it', () => {
    expect(() => parseCronExpression('*/5 2 * * *')).toThrow(InvalidCronExpressionError);
    expect(() => parseCronExpression('0 2 1,15 * *')).toThrow(InvalidCronExpressionError);
    expect(() => parseCronExpression('0 2 * * MON')).toThrow(InvalidCronExpressionError);
    expect(() => parseCronExpression('0 2 * 3 *')).toThrow(InvalidCronExpressionError);
    expect(() => parseCronExpression('0 2 * *')).toThrow(InvalidCronExpressionError);
    expect(() => parseCronExpression('99 2 * * *')).toThrow(InvalidCronExpressionError);
  });
});

describe('nextFireAt', () => {
  it('finds the next daily fire in a plain UTC deployment', () => {
    const next = nextFireAt('0 2 * * *', new Date('2026-05-04T09:00:00Z'), 'UTC');

    expect(next?.toISOString()).toBe('2026-05-05T02:00:00.000Z');
  });

  it('is strictly after the reference, never the instant you are standing on', () => {
    const onTheBoundary = new Date('2026-05-04T02:00:00Z');

    expect(nextFireAt('0 2 * * *', onTheBoundary, 'UTC')?.toISOString()).toBe(
      '2026-05-05T02:00:00.000Z'
    );
  });

  it('finds the next weekly fire on the configured weekday', () => {
    // From Wednesday 11 March, the next Monday is the 16th; 02:00 EDT is 06:00Z.
    const next = nextFireAt('0 2 * * 1', new Date('2026-03-11T12:00:00Z'), NEW_YORK);

    expect(next?.toISOString()).toBe('2026-03-16T06:00:00.000Z');
  });

  it('finds the next monthly fire on the configured day', () => {
    const next = nextFireAt('30 3 15 * *', new Date('2026-01-20T00:00:00Z'), 'UTC');

    expect(next?.toISOString()).toBe('2026-02-15T03:30:00.000Z');
  });

  describe('across the spring-forward transition', () => {
    // 2026-03-08, America/New_York: 02:00 EST becomes 03:00 EDT. Local times
    // from 02:00 to 02:59 DO NOT EXIST on that date.
    it('runs a backup whose local time does not exist at the instant the clock jumped to', () => {
      const next = nextFireAt('0 2 * * *', new Date('2026-03-07T12:00:00Z'), NEW_YORK);

      // 07:00Z is 03:00 EDT - one hour "late", and the whole point: the
      // alternative is a night with no backup at all, once a year, silently.
      expect(next?.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    });

    it('treats the following day as 23 hours later, not 24', () => {
      const afterTheGap = new Date('2026-03-08T07:00:00.001Z');
      const next = nextFireAt('0 2 * * *', afterTheGap, NEW_YORK);

      expect(next?.toISOString()).toBe('2026-03-09T06:00:00.000Z');
      // A scheduler that added 86_400_000ms would land at 07:00Z - 03:00 local
      // - and stay an hour off for the next eight months.
      expect(next!.getTime() - afterTheGap.getTime()).toBeLessThan(24 * 60 * 60 * 1_000);
    });
  });

  describe('across the fall-back transition', () => {
    // 2026-11-01, America/New_York: 02:00 EDT becomes 01:00 EST, so local
    // times from 01:00 to 01:59 HAPPEN TWICE.
    it('takes the first pass of an ambiguous local time, not the second', () => {
      const next = nextFireAt('0 1 * * *', new Date('2026-10-31T12:00:00Z'), NEW_YORK);

      // 05:00Z is 01:00 EDT (the first pass); 06:00Z would be 01:00 EST.
      // Running once, early, is right: the second pass is a boundary that has
      // already been recorded, which #282's "did this boundary run" check
      // absorbs.
      expect(next?.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    });

    it('treats the following day as 25 hours later, not 24', () => {
      const beforeTheRepeat = new Date('2026-10-31T06:00:00.001Z'); // just after 02:00 EDT
      const next = nextFireAt('0 2 * * *', beforeTheRepeat, NEW_YORK);

      // 02:00 EST on 1 November is 07:00Z.
      expect(next?.toISOString()).toBe('2026-11-01T07:00:00.000Z');
      expect(next!.getTime() - beforeTheRepeat.getTime()).toBeGreaterThan(24 * 60 * 60 * 1_000);
    });
  });

  it('returns null for a reference that is not a date', () => {
    // The other `null`: a walk that finds nothing. Reserved for exactly this
    // kind of unusable input - a bad TIMEZONE throws instead, so the caller
    // can tell the two apart.
    expect(nextFireAt('0 2 * * *', new Date('not a date'), 'UTC')).toBeNull();
  });

  it('throws a typed error for a timezone this runtime does not know', () => {
    expect(() => nextFireAt('0 2 * * *', new Date('2026-05-04T09:00:00Z'), 'Mars/Olympus')).toThrow(
      InvalidTimezoneError
    );
  });
});

describe('previousFireBoundary', () => {
  it('returns the most recent boundary at or before now', () => {
    const boundary = previousFireBoundary('0 2 * * *', new Date('2026-05-04T09:00:00Z'), 'UTC');

    expect(boundary?.toISOString()).toBe('2026-05-04T02:00:00.000Z');
  });

  it('includes the boundary you are standing exactly on', () => {
    // A run triggered on time has to record THIS boundary, not yesterday's -
    // otherwise #282 would take a second backup a minute later.
    const boundary = previousFireBoundary('0 2 * * *', new Date('2026-05-04T02:00:00Z'), 'UTC');

    expect(boundary?.toISOString()).toBe('2026-05-04T02:00:00.000Z');
  });

  it('walks back to the previous week for a weekly schedule', () => {
    // Wednesday 11 March; the previous Monday is the 9th, 02:00 EDT = 06:00Z.
    const boundary = previousFireBoundary('0 2 * * 1', new Date('2026-03-11T12:00:00Z'), NEW_YORK);

    expect(boundary?.toISOString()).toBe('2026-03-09T06:00:00.000Z');
  });

  it('agrees with nextFireAt about the shifted boundary on a spring-forward day', () => {
    // Later the same morning: the boundary that "should have" been 02:00 local
    // is the 03:00 EDT instant the clock jumped to, and both functions have to
    // name the same one or a run is recorded against a boundary the scheduler
    // will then consider outstanding.
    const boundary = previousFireBoundary('0 2 * * *', new Date('2026-03-08T10:00:00Z'), NEW_YORK);

    expect(boundary?.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(nextFireAt('0 2 * * *', new Date('2026-03-07T12:00:00Z'), NEW_YORK)?.toISOString()).toBe(
      boundary?.toISOString()
    );
  });

  it('throws the same typed timezone error as nextFireAt', () => {
    expect(() =>
      previousFireBoundary('0 2 * * *', new Date('2026-05-04T09:00:00Z'), 'Nowhere/Special')
    ).toThrow(InvalidTimezoneError);
  });
});

// =============================================================================
// frequency: 'cron' (PP-14.12)
// =============================================================================

describe('backupScheduleToCron with frequency cron', () => {
  it('passes the operator\'s expression through, trimmed', () => {
    expect(backupScheduleToCron({ frequency: 'cron', cron: '  0 */6 * * *  ', timeOfDay: '04:00' })).toBe('0 */6 * * *');
  });

  it('degrades a blank expression to the daily default rather than throwing', () => {
    expect(backupScheduleToCron({ frequency: 'cron', cron: '   ', timeOfDay: '04:30' })).toBe('30 4 * * *');
    expect(backupScheduleToCron({ frequency: 'cron' })).toBe('0 2 * * *');
  });
});

describe('parseBackupCron', () => {
  it('reads lists, ranges, steps and stars in every field it supports', () => {
    expect(parseBackupCron('0 */6 * * *')).toEqual({ minutes: [0], hours: [0, 6, 12, 18], daysOfMonth: null, daysOfWeek: null });
    expect(parseBackupCron('15,45 8-10 * * 1-5')).toEqual({ minutes: [15, 45], hours: [8, 9, 10], daysOfMonth: null, daysOfWeek: [1, 2, 3, 4, 5] });
    expect(parseBackupCron('0 2 1,15 * *')).toEqual({ minutes: [0], hours: [2], daysOfMonth: [1, 15], daysOfWeek: null });
    expect(parseBackupCron('0 0-12/4 */10 * *').hours).toEqual([0, 4, 8, 12]);
    expect(parseBackupCron('0 2 */10 * *').daysOfMonth).toEqual([1, 11, 21, 31]);
    expect(parseBackupCron('30 3/6 * * *').hours).toEqual([3, 9, 15, 21]);
  });

  it('is a superset of the subset the settings form emits', () => {
    for (const expression of ['0 2 * * *', '45 23 * * 3', '5 4 15 * *']) {
      const old = parseCronExpression(expression);
      const parsed = parseBackupCron(expression);
      expect(parsed.minutes).toEqual([old.minute]);
      expect(parsed.hours).toEqual([old.hour]);
    }
  });

  it.each([
    ['too few fields', '0 2 * *'],
    ['too many fields', '0 2 * * * *'],
    ['a restricted month', '0 2 * 3 *'],
    ['both day fields restricted', '0 2 15 * 1'],
    ['a name', '0 2 * * MON'],
    ['an out-of-range minute', '60 2 * * *'],
    ['an out-of-range hour', '0 24 * * *'],
    ['a reversed range', '0 10-2 * * *'],
    ['a zero step', '*/0 * * * *'],
    ['an empty list item', '0,,5 * * * *'],
    ['day of week 7', '0 2 * * 7'],
    ['day of month 0', '0 2 0 * *'],
    ['a macro', '@hourly'],
  ])('rejects %s', (_label, expression) => {
    expect(() => parseBackupCron(expression)).toThrow(InvalidCronExpressionError);
  });
});

describe('minimumCronIntervalMinutes and assertBackupCron', () => {
  it.each([
    ['0 * * * *', 60],
    ['0 */6 * * *', 360],
    ['0 2 * * *', 1440],
    ['0 2 * * 1', 10080],
    ['0 2,3 * * *', 60],
    ['0 23,0 * * *', 60],
    ['*/30 * * * *', 30],
    ['* * * * *', 1],
    ['0 1,2 * * 1', 60],
    ['0 2 1,2 * *', 1440],
  ])('%s fires at least %d minutes apart', (expression, minutes) => {
    expect(minimumCronIntervalMinutes(parseBackupCron(expression))).toBe(minutes);
  });

  it('counts the gap across midnight between the last and the first fire of the next day', () => {
    // 23:30 and 00:00 on consecutive days are 30 minutes apart.
    expect(minimumCronIntervalMinutes(parseBackupCron('30,0 23,0 * * *'))).toBe(30);
  });

  it('treats a schedule that fires once in the window as unbounded', () => {
    expect(minimumCronIntervalMinutes(parseBackupCron('0 2 29 * *'))).toBeGreaterThan(1440);
  });

  it('accepts an hourly expression and refuses anything finer, naming the interval', () => {
    expect(assertBackupCron('0 * * * *').hours).toHaveLength(24);
    expect(() => assertBackupCron('*/59 * * * *')).toThrow(CronIntervalTooShortError);
    try {
      assertBackupCron('*/15 * * * *');
    } catch (error) {
      expect((error as CronIntervalTooShortError).intervalMinutes).toBe(15);
      expect((error as Error).message).toContain('at least 60 minutes');
    }
  });

  it('takes the minimum as a parameter', () => {
    expect(() => assertBackupCron('*/15 * * * *', 15)).not.toThrow();
  });

  it('rejects a malformed expression with the parser\'s error', () => {
    expect(() => assertBackupCron('hourly')).toThrow(InvalidCronExpressionError);
  });
});

describe('nextFireAt and previousFireBoundary over a multi-fire expression', () => {
  it('walks several fires in one day', () => {
    const at = (iso: string) => new Date(iso);

    expect(nextFireAt('0 */6 * * *', at('2026-05-04T07:00:00Z'), 'UTC')?.toISOString()).toBe('2026-05-04T12:00:00.000Z');
    expect(nextFireAt('0 */6 * * *', at('2026-05-04T18:00:00Z'), 'UTC')?.toISOString()).toBe('2026-05-05T00:00:00.000Z');
    expect(previousFireBoundary('0 */6 * * *', at('2026-05-04T11:59:00Z'), 'UTC')?.toISOString()).toBe('2026-05-04T06:00:00.000Z');
    expect(previousFireBoundary('0 */6 * * *', at('2026-05-04T12:00:00Z'), 'UTC')?.toISOString()).toBe('2026-05-04T12:00:00.000Z');
    expect(previousFireBoundary('0 */6 * * *', at('2026-05-04T00:10:00Z'), 'UTC')?.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('looks back to the previous matching day when today has not fired yet', () => {
    // Weekdays 08:00 and 16:00; asked on Monday 06:00, the boundary is Friday 16:00.
    expect(previousFireBoundary('0 8,16 * * 1-5', new Date('2026-05-04T06:00:00Z'), 'UTC')?.toISOString()).toBe('2026-05-01T16:00:00.000Z');
    expect(nextFireAt('0 8,16 * * 1-5', new Date('2026-05-01T16:00:00Z'), 'UTC')?.toISOString()).toBe('2026-05-04T08:00:00.000Z');
  });

  it('honours the zone for every fire of the day', () => {
    // 09:00 and 17:00 New York in July (EDT, UTC-4).
    expect(nextFireAt('0 9,17 * * *', new Date('2026-07-01T12:00:00Z'), NEW_YORK)?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(previousFireBoundary('0 9,17 * * *', new Date('2026-07-01T12:00:00Z'), NEW_YORK)?.toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });

  it('still throws the typed errors', () => {
    expect(() => nextFireAt('0 */6 * * *', new Date('2026-05-04T09:00:00Z'), 'Mars/Olympus')).toThrow(InvalidTimezoneError);
    expect(() => nextFireAt('not a cron', new Date('2026-05-04T09:00:00Z'), 'UTC')).toThrow(InvalidCronExpressionError);
  });
});
