import { createHash } from 'node:crypto';

// =============================================================================
// The incident state machine (issue #1047)
// =============================================================================
//
// PURE: no I/O, no clock (the instant is an argument), no Nest. The evaluator
// feeds it one open incident (or none) and one observation (or none) per rule
// and label set, and does what it answers. Unit-tested in isolation.
//
//   observation   open incident        answer
//   ------------  -------------------  ------------------------------------------
//   breached      none                 open `firing` (forSeconds = 0) or `pending`
//   breached      pending, held long   promote to firing (notify)
//   breached      pending, not yet     touch
//   breached      firing               touch
//   clear/absent  none                 none
//   clear/absent  pending              discard (it never fired: no history)
//   clear/absent  firing               resolve (notify)
//
// Resolution is on the FIRST clean evaluation (no hysteresis): a rule that
// flaps is tamed with `forSeconds` and `cooldownSeconds`, not by delaying the
// resolve.
// =============================================================================

/** Longest `labelsKey` the column holds. */
export const LABELS_KEY_MAX = 512;

/**
 * The open incident of one rule and label set, as the machine needs it.
 *
 * @stability experimental
 */
export interface OpenIncidentState {
  /** The incident id. */
  readonly id: string;
  /** `pending` or `firing`. */
  readonly state: 'pending' | 'firing';
  /** When the condition first held. */
  readonly pendingSince: Date | null;
}

/**
 * What the evaluator observed for a label set.
 *
 * @stability experimental
 */
export interface TransitionObservation {
  /** Whether the rule's condition holds for the label set. */
  readonly breached: boolean;
}

/**
 * The inputs of one transition.
 *
 * @stability experimental
 */
export interface TransitionInput {
  /** The instant of the evaluation. */
  readonly now: Date;
  /** The open incident for this rule and labels, or `null`. */
  readonly open: OpenIncidentState | null;
  /** This evaluation's observation for the labels; `null` when the kind did not report them. */
  readonly observation: TransitionObservation | null;
  /** The rule's `forSeconds`. */
  readonly forSeconds: number;
}

/**
 * What the evaluator must do: `none`; `open` a new incident in `state`;
 * `touch` an open one; `promote` a pending one to firing; `discard` a pending
 * one that cleared; `resolve` a firing one. A `notify` of `true` marks the
 * answers that raise a notification (subject to the cooldown, decided by
 * {@link shouldNotify}).
 *
 * @stability experimental
 */
export interface Transition {
  /** The action. */
  readonly type: 'none' | 'open' | 'touch' | 'promote' | 'discard' | 'resolve';
  /** For `open`: the state the new incident starts in. */
  readonly state?: 'pending' | 'firing';
  /** Whether the answer raises a notification (absent when it does not). */
  readonly notify?: boolean;
}

/**
 * The next transition for one rule and label set.
 *
 * @param input - the open incident, the observation, the rule's wait and the instant.
 * @returns the answer.
 *
 * @stability experimental
 */
export function nextTransition(input: TransitionInput): Transition {
  const { open, observation, now, forSeconds } = input;
  const breached = observation?.breached === true;

  if (breached) {
    if (!open) {
      return forSeconds <= 0
        ? { type: 'open', state: 'firing', notify: true }
        : { type: 'open', state: 'pending', notify: false };
    }
    if (open.state === 'firing') return { type: 'touch' };
    const since = open.pendingSince?.getTime() ?? now.getTime();
    return now.getTime() - since >= forSeconds * 1000 ? { type: 'promote', notify: true } : { type: 'touch' };
  }

  if (!open) return { type: 'none' };
  return open.state === 'pending' ? { type: 'discard' } : { type: 'resolve', notify: true };
}

/**
 * Whether a FIRED (and its matching RESOLVED) notification is sent: not when
 * the same rule and labels resolved less than `cooldownSeconds` before this
 * incident fired. The incident is recorded either way. Derived from stored
 * times, so the resolve decision repeats the fire decision exactly.
 *
 * @param firedAt - when this incident fired.
 * @param previousResolvedAt - when the previous incident of the same rule and labels resolved, or `null`.
 * @param cooldownSeconds - the rule's cooldown.
 * @returns whether to notify.
 *
 * @stability experimental
 */
export function shouldNotify(firedAt: Date, previousResolvedAt: Date | null, cooldownSeconds: number): boolean {
  if (!previousResolvedAt || cooldownSeconds <= 0) return true;
  return firedAt.getTime() - previousResolvedAt.getTime() >= cooldownSeconds * 1000;
}

/**
 * The canonical identity of a label set within a rule: keys sorted, `k=v`
 * joined by `,`, each side percent-encoded so a `,` or `=` in a value cannot
 * collide two sets. `''` when unlabelled. A key past the column width keeps its
 * head and ends in a hash of the whole.
 *
 * @param labels - the labels.
 * @returns the key.
 *
 * @stability experimental
 */
export function labelsKeyOf(labels: Readonly<Record<string, string>>): string {
  const key = Object.keys(labels)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(labels[name] ?? '')}`)
    .join(',');
  if (key.length <= LABELS_KEY_MAX) return key;
  return `${key.slice(0, LABELS_KEY_MAX - 33)}~${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}
