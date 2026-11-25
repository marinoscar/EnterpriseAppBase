import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { cliName } from '../../identity.js';
import { formatError } from '../../errors.js';
import { runDoctor, type DoctorReport } from '../../node/doctor.js';
import { registerNode, enrollNode } from '../../node/enrollment.js';
import { spawnDetachedDaemon } from '../../node/lifecycle.js';
import { formatLogRecord } from '../../node/logger.js';
import { HttpNodeApi } from '../../node/node-api.js';
import { resolveNodeConfig, type ResolvedNodeConfig } from '../../node/node-config.js';
import {
  describeEvent,
  elapsedMs,
  formatDuration,
  nodeDashboardReducer,
  type DashboardState,
  type NodeDashboardData,
} from '../../node/node-dashboard-source.js';
import type { NodeEngineEvent } from '../../node/node-events.js';
import { embeddedNodeFeed, isDaemonListening } from '../dashboard/node-embedded.js';
import { DashboardSource, daemonAttachFeed, selectDashboardFeed, type DashboardConnection } from '../dashboard/source.js';
import { useDashboard } from '../dashboard/use-dashboard.js';
import { nodeLogPath, nodePidPath, nodeSocketPath, nodeStateDir } from '../../node/paths.js';
import { ErrorNotice, Field, Frame } from '../layout.js';
import { useTuiTheme } from '../context.js';
import { textColor } from '../theme.js';
import { ScrollBox } from '../scroll-box.js';
import { TuiScreenSections } from '../screen-sections.js';
import { EventLog, MeterLegend, SegmentMeter, type TuiLogEvent, type TuiMeterSegment } from '../ui/index.js';

// =============================================================================
// The worker node screen  (issue #279, epic #254)
// =============================================================================
//
// ONE SCREEN, NOT FIVE ROUTES — the same reasoning as the deploy screen: this
// TUI has no history stack (see routes.ts), so a route per action would return
// to the TOP menu, and choosing a second action would mean walking in from the
// start every time.
//
// IT CALLS THE SAME FUNCTIONS THE SUBCOMMANDS CALL. `registerNode`,
// `enrollNode`, `runDoctor` and `NodeDashboardSource` are shared verbatim;
// only the rendering differs. There is no orchestration logic in this file at
// all, which is what "no duplicated logic" means here and is asserted
// structurally in `node-dashboard-source.test.ts`.
//
// -----------------------------------------------------------------------------
// ATTACHING IS READ-ONLY
// -----------------------------------------------------------------------------
//
// The dashboard renders a stream the daemon already pushes and sends nothing
// back, so an operator can inspect a systemd unit or a container running
// production work without perturbing it, and pressing Esc leaves it running
// untouched. A TUI that could stop a fleet member from a highlighted row is a
// liability; `set-concurrency` and `stop` stay one-line commands.
//
// -----------------------------------------------------------------------------
// WITH NO DAEMON RUNNING, IT SPAWNS A DETACHED ONE AND ATTACHES (`s`)
// -----------------------------------------------------------------------------
//
// Rather than running the engine inside this process. That is deliberate: an
// interactive process CANNOT re-exec itself to raise its heap ceiling (#277)
// without destroying raw-mode input, so sustained work in-process would
// silently run at the low default limit — the least suitable configuration for
// exactly the long jobs a node exists to take. The detached daemon gets the
// tuning; the TUI gets a stream.
//
// AN EMBEDDED MODE EXISTS, BEHIND AN EXPLICIT KEY (`e`, RETRO-G1.3)
// -----------------------------------------------------------------------------
//
// For a quick look, a laptop or a demo, `e` starts the engine in this process
// (`embeddedNodeFeed`, which goes through `startNode` — the screen never
// constructs an engine itself) and renders it through the same reducer. The
// screen says, before the key is pressed and again while it runs, what that
// costs: the default heap, and a memory valve that closes the whole TUI.
// =============================================================================

export interface NodeScreenProps {
  onDone: () => void;
}

type Action = 'dashboard' | 'register' | 'enroll' | 'doctor' | 'logs';

interface ActionItem {
  key: string;
  label: string;
  value: Action | 'back';
}

export function NodeScreen({ onDone }: NodeScreenProps): ReactNode {
  const theme = useTuiTheme();
  const [action, setAction] = useState<Action | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<NodeDashboardSourceType | undefined>(undefined);
  const [doctorReport, setDoctorReport] = useState<DoctorReport | undefined>(undefined);

  const config = useMemo<ResolvedNodeConfig | undefined>(() => {
    try {
      return resolveNodeConfig();
    } catch {
      // A machine that has never logged in still gets a usable screen: Enroll
      // is precisely what it needs, and refusing to render would hide it.
      return undefined;
    }
  }, []);

  // Esc always returns, and the dashboard is read-only, so unlike the deploy
  // screen there is nothing here that Esc must be refused during.
  useInput((_input, key) => {
    if (!key.escape) return;
    if (action === undefined) {
      onDone();
      return;
    }
    setAction(undefined);
    setSource(undefined);
    setError(undefined);
    setNotice(undefined);
  });

  // Detaching is `useDashboard`'s job: leaving the dashboard unmounts its
  // view, whose effect cleanup stops the source. Without that the source's
  // reconnect timer would outlive the screen and keep the ink process alive,
  // which looks exactly like a hang.
  const startDashboard = useCallback(() => {
    setSource(new DashboardSource(nodeDashboardReducer, daemonAttachFeed<NodeEngineEvent>({ socketPath: nodeSocketPath() })));
  }, []);

  // `e`: run the worker in this process. If a daemon appeared in the meantime,
  // attach to it instead — never a second worker on the same state directory.
  const startEmbedded = useCallback(async () => {
    const socketPath = nodeSocketPath();
    const feed = await selectDashboardFeed<NodeEngineEvent>({
      socketPath,
      isDaemonRunning: () => isDaemonListening(socketPath),
      embedded: () => embeddedNodeFeed(),
    });
    setSource(new DashboardSource(nodeDashboardReducer, feed));
  }, []);

  const run = useCallback(
    async (chosen: Action) => {
      setAction(chosen);
      setError(undefined);
      setNotice(undefined);

      if (chosen === 'dashboard') {
        startDashboard();
        return;
      }

      if (chosen === 'logs') {
        return; // rendered straight from the file below
      }

      if (config === undefined) {
        setError(`No server or credential is configured. Choose Enroll, or run \`${cliName()} node enroll\`.`);
        return;
      }

      setBusy(true);
      try {
        if (chosen === 'register') {
          const api = HttpNodeApi.create(config.serverUrl, config.token);
          const result = await registerNode({ api, node: config.node });
          setNotice(
            `${result.reattached ? 'Reattached to' : 'Registered'} "${result.node.name}" (${result.node.id}).`,
          );
        } else if (chosen === 'enroll') {
          const result = await enrollNode({
            serverUrl: config.serverUrl,
            hooks: {
              onCodeIssued: (grant) => {
                setNotice(`Open ${grant.verificationUriComplete} and confirm the code ${grant.userCode}`);
              },
            },
          });
          setNotice(`Enrolled. Credential "${result.credentialName}" stored in ${result.configPath}.`);
        } else {
          const report = await runDoctor({
            config,
            socketPath: nodeSocketPath(),
            pidPath: nodePidPath(),
            stateDir: nodeStateDir(),
            api: HttpNodeApi.create(config.serverUrl, config.token),
          });
          setDoctorReport(report);
        }
      } catch (caught) {
        setError(formatError(caught));
      } finally {
        setBusy(false);
      }
    },
    [config, startDashboard],
  );

  // ---------------------------------------------------------------------------
  // The action list
  // ---------------------------------------------------------------------------
  if (action === undefined) {
    const items: ActionItem[] = [
      { key: 'dashboard', label: 'Dashboard  (attach to the running worker)', value: 'dashboard' },
      { key: 'doctor', label: 'Doctor  (machine, server, worker)', value: 'doctor' },
      { key: 'logs', label: 'Logs', value: 'logs' },
      { key: 'register', label: 'Register this machine', value: 'register' },
      { key: 'enroll', label: 'Enroll  (login and mint a node credential)', value: 'enroll' },
      { key: 'back', label: 'Back', value: 'back' },
    ];

    return (
      <Frame title="Worker node" hints={['↑↓ move', 'enter select', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            {config === undefined
              ? 'Not configured on this machine yet.'
              : `${config.node.name} · ${config.serverUrl} · concurrency ${config.node.concurrency}`}
          </Text>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'back') {
                onDone();
                return;
              }
              void run(item.value);
            }}
          />
          <TuiScreenSections screen="node" />
        </Box>
      </Frame>
    );
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  if (action === 'dashboard') {
    return <DashboardView source={source} onEmbedded={() => void startEmbedded()} />;
  }

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------
  if (action === 'logs') {
    return <LogView />;
  }

  // ---------------------------------------------------------------------------
  // Doctor / register / enroll
  // ---------------------------------------------------------------------------
  return (
    <Frame title={`Worker node — ${action}`} hints={['esc back']}>
      <Box flexDirection="column" gap={1}>
        {busy ? (
          <Text>
            <Spinner type="dots" /> Working…
          </Text>
        ) : null}
        {notice !== undefined ? <Text {...textColor(theme.success)}>{notice}</Text> : null}
        {error !== undefined ? <ErrorNotice message={error} /> : null}
        {doctorReport !== undefined
          ? doctorReport.checks.map((check) => (
              <Field
                key={check.id}
                label={check.label}
                value={check.detail}
                {...textColor(check.status === 'fail' ? theme.error : check.status === 'warn' ? theme.warning : theme.success)}
              />
            ))
          : null}
      </Box>
    </Frame>
  );
}

// -----------------------------------------------------------------------------
// The dashboard view
// -----------------------------------------------------------------------------

type NodeDashboardSourceType = DashboardSource<NodeDashboardData, NodeEngineEvent>;

function DashboardView({
  source,
  onEmbedded,
}: {
  source: NodeDashboardSourceType | undefined;
  onEmbedded: () => void;
}): ReactNode {
  const theme = useTuiTheme();
  const state = useDashboard(source) as (NodeDashboardData & DashboardConnection) | undefined;
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | undefined>(undefined);
  // A ticking clock so elapsed times advance between events, which on a worker
  // running one long job is most of the time.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const waiting = state === undefined || (!state.connected && !state.everConnected);

  useInput((input) => {
    // Only while no worker has been found: once attached (or embedded) these
    // keys would start a second worker beside the first.
    if (!waiting || spawning) return;
    if (input === 's') {
      setSpawning(true);
      try {
        // The DETACHED, memory-tuned daemon — never the engine in this
        // process. The source keeps looking for the socket and attaches when
        // it appears.
        spawnDetachedDaemon({ logPath: nodeLogPath(), args: ['node', 'start'] });
      } catch (error) {
        setSpawnError(formatError(error));
      } finally {
        setSpawning(false);
      }
    } else if (input === 'e') {
      onEmbedded();
    }
  });

  const snapshot = state?.snapshot;

  const lines = useMemo(() => (state?.events ?? []).map(describeEvent), [state?.events]);
  const recent = useMemo(() => recentJobs(state?.events ?? []), [state?.events]);

  if (state === undefined || waiting) {
    return (
      <Frame title="Worker node — dashboard" hints={['s start a worker', 'e run in this terminal', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text>
            <Spinner type="dots" /> {state?.error ?? 'Looking for a running worker…'}
          </Text>
          <Text dimColor>
            Press <Text bold>s</Text> to start one in the background and attach to it.
          </Text>
          <Text dimColor>
            Or press <Text bold>e</Text> to run it inside this terminal. It keeps the default memory limit (this
            process cannot restart itself with a bigger one), and if the memory safety valve fires it closes this
            screen with it.
          </Text>
          {spawnError !== undefined ? <ErrorNotice message={spawnError} /> : null}
        </Box>
      </Frame>
    );
  }

  return (
    <Frame title="Worker node — dashboard" hints={['↑↓ scroll', state.mode === 'embedded' ? 'esc stop and leave' : 'esc detach']}>
      <Box flexDirection="column" gap={1}>
        <Box gap={2}>
          <Text {...textColor(state.connected ? theme.success : theme.warning)}>
            {state.connected ? (state.mode === 'embedded' ? '● running here' : '● attached') : '○ reconnecting'}
          </Text>
          <Text dimColor>{snapshot?.nodeId ?? '(unknown node)'}</Text>
        </Box>

        {state.mode === 'embedded' ? (
          <Text {...textColor(theme.warning)}>
            Running in this terminal at the default memory limit; leaving this screen stops the worker. Use{' '}
            {cliName()} node start for sustained work.
          </Text>
        ) : null}

        {snapshot !== undefined ? (
          <Box flexDirection="column">
            <Field label="Status" value={snapshot.status} />
            <Field label="Concurrency" value={String(snapshot.concurrency)} />
            <Field label="Types" value={snapshot.eligibleTypes.join(', ') || '(none)'} />
            <Field
              label="Heartbeat"
              value={snapshot.heartbeatAgeMs === null ? 'never' : `${Math.round(snapshot.heartbeatAgeMs / 1000)}s ago`}
            />
          </Box>
        ) : null}

        {snapshot !== undefined && snapshot.counters.claimed > 0 ? (
          <Box flexDirection="column">
            <Text bold>Totals</Text>
            <SegmentMeter segments={totalsSegments(snapshot.counters)} total={snapshot.counters.claimed} />
            <MeterLegend segments={totalsSegments(snapshot.counters)} total={snapshot.counters.claimed} />
          </Box>
        ) : null}

        {recent.length > 0 ? <EventLog events={recent} kinds={RECENT_JOB_KINDS} maxVisible={5} title="Recent jobs" /> : null}

        {snapshot !== undefined && snapshot.activeJobs.length > 0 ? (
          <Box flexDirection="column">
            <Text bold>Active</Text>
            {snapshot.activeJobs.map((job) => (
              <Text key={job.jobId}>
                {'  '}
                {job.type} {job.jobId} — {formatDuration(elapsedMs(job.startedAt, now))}
              </Text>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Text bold>Events</Text>
          <ScrollBox lines={lines} reservedRows={18} isActive followTail />
        </Box>
      </Box>
    </Frame>
  );
}

// -----------------------------------------------------------------------------
// The totals meter and the recent-jobs log (the component kit, `../ui`)
// -----------------------------------------------------------------------------

type RecentJobKind = 'succeeded' | 'failed' | 'rate-limited';

const RECENT_JOB_KINDS = {
  succeeded: { glyph: '✓', tone: 'success' },
  failed: { glyph: '✗', tone: 'error' },
  'rate-limited': { glyph: '⏳', tone: 'warning' },
} as const;

/** The claimed jobs split by outcome; whatever is left of `claimed` is still running or queued. */
function totalsSegments(counters: {
  claimed: number;
  succeeded: number;
  failed: number;
  rateLimited: number;
}): TuiMeterSegment[] {
  const settled = counters.succeeded + counters.failed + counters.rateLimited;
  return [
    { id: 'ok', label: 'ok', count: counters.succeeded, tone: 'success', done: true },
    { id: 'failed', count: counters.failed, tone: 'error', done: true },
    { id: 'rate-limited', count: counters.rateLimited, tone: 'warning', done: true },
    { id: 'in progress', count: Math.max(0, counters.claimed - settled), tone: 'primary' },
  ];
}

/** The newest job outcomes, oldest first. */
function recentJobs(events: DashboardState['events']): TuiLogEvent<RecentJobKind>[] {
  const out: TuiLogEvent<RecentJobKind>[] = [];
  events.forEach((event, index) => {
    if (event.kind === 'job-succeeded') {
      out.push({ id: `${index}:${event.jobId}`, kind: 'succeeded', text: `${event.type} ${event.jobId}`, detail: formatDuration(event.durationMs) });
    } else if (event.kind === 'job-failed') {
      out.push({
        id: `${index}:${event.jobId}`,
        kind: event.rateLimited ? 'rate-limited' : 'failed',
        text: `${event.type} ${event.jobId}`,
        detail: event.error,
        retrying: event.willRetry,
      });
    }
  });
  return out.slice(-5);
}

// -----------------------------------------------------------------------------
// The log view
// -----------------------------------------------------------------------------

function LogView(): ReactNode {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        // Dynamic, so the file read is not attempted at module load — this
        // screen is mounted only when chosen.
        const { readLogTail } = await import('../../node/logger.js');
        const records = readLogTail(nodeLogPath(), 200);
        if (!cancelled) setLines(records.map(formatLogRecord));
      } catch (caught) {
        if (!cancelled) setError(formatError(caught));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Frame title="Worker node — logs" hints={['↑↓ scroll', 'esc back']}>
      {error !== undefined ? (
        <ErrorNotice message={error} />
      ) : lines.length === 0 ? (
        <Text dimColor>No log lines yet — {nodeLogPath()}</Text>
      ) : (
        <ScrollBox lines={lines} reservedRows={8} isActive followTail />
      )}
    </Frame>
  );
}
