/**
 * Admin → Operations → About (`/admin/settings/about`).
 *
 * Issue #401, epic #397. A REGISTRY CARD and nothing else, per CLAUDE.md's
 * MANDATORY Settings UI Pattern: one entry in `ADMIN_SECTIONS`
 * (`config/adminSections.tsx`), one route in `App.tsx` gated on the same
 * permission string the API enforces (`system_settings:read`, the literal
 * `about/about.controller.ts` declares), and no tab anywhere. The hub, the
 * Console rail and the compact AppBar title all pick this page up from that
 * single declaration.
 *
 * The question it answers is one sentence long and is asked during incidents:
 * **what is actually running on this box?** A commit SHA, a ref, when it was
 * installed, when it was last updated, who deployed it, and whether the deploy
 * run that put it there finished.
 *
 * =============================================================================
 * THREE RENDER STATES, NOT TWO. THE THIRD IS THE ONE THAT GETS FORGOTTEN.
 * =============================================================================
 *
 *   1. `deployInfoStatus: 'ok'` with `run.outcome !== 'failure'` — the facts.
 *   2. `deployInfoStatus: 'absent' | 'invalid'` — no usable document. The
 *      page still renders everything it DOES know (the API's own version, the
 *      database) and says what was looked at.
 *   3. `deployInfoStatus: 'ok'` AND `run.outcome === 'failure'` — a COMPLETE
 *      document describing a run that failed partway. Every fact renders
 *      exactly as in state 1, PLUS a warning naming `run.failedStep`.
 *
 * State 3 is not a variant of state 2 and must never be collapsed into it. A
 * run that got far enough to write the document DID deploy something: there is
 * a real commit on this machine, the steps in `run.completed` really ran, and
 * `run.failedStep` names the one that did not. Hiding the facts behind the
 * warning — or rendering the "no record" branch because `outcome` is not
 * `'success'` — throws away every fact the operator came for at the exact
 * moment they came for it. The warning is ADDITIVE; the facts are unconditional.
 *
 * =============================================================================
 * ⚠ THE `absent` COPY ASSERTS NOTHING ABOUT HOW THIS INSTANCE WAS DEPLOYED
 * =============================================================================
 *
 * There is deliberately no sentence anywhere on this page meaning "this
 * instance was not deployed with the CLI", and adding one would be a
 * regression, not a clarification. That sentence is a claim about the world and
 * it is FALSE in at least three ordinary situations:
 *
 *   - `DEPLOY_INFO_PATH` points somewhere the file is not;
 *   - the bind mount carrying it did not attach to this container;
 *   - a deploy run stopped before it got as far as writing the file.
 *
 * In all three the deployment was very much made with the CLI, and telling the
 * operator otherwise sends them to rebuild something that is already there.
 * What this page says instead is only what is true: **no deployment record was
 * found at the path the API looked at** — and then it shows that path, which is
 * the one fact that distinguishes all three. The API's own DTO makes the same
 * argument at length (`apps/api/src/about/dto/about-response.dto.ts`); this
 * page is the half of it that has to word the sentence.
 *
 * =============================================================================
 * `database: null` IS A FACT, NOT A PAGE ERROR
 * =============================================================================
 *
 * The endpoint answers 200 with `database: null` and a `databaseError` string
 * when the probe fails, precisely so this page stays readable while the
 * database is down — the API version, the commit SHA and the deploy document
 * are all perfectly knowable with no database at all. So `databaseError` is
 * rendered INSIDE the database section as that section's own state, never
 * hoisted to the page-level error Alert, which is reserved for a request that
 * actually failed (a 403, a network error, a maintenance window).
 *
 * =============================================================================
 * NO POLL
 * =============================================================================
 *
 * Unlike the fleet page next door, nothing here changes while you watch: a
 * deployment's identity changes when somebody deploys. `useAbout` exposes an
 * explicit `refresh` instead, and the API re-reads the document from disk on
 * every request, so that button genuinely picks up a fresh deploy with no
 * restart and no page reload.
 */

import { Fragment, type ReactNode } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Navigate } from 'react-router-dom';
import { useAbout } from '../../hooks/useAbout';
import { usePermissions } from '../../hooks/usePermissions';
import { formatRelativeTime } from '../../utils/relativeTime';

/** Mirrors the `About` card in `config/adminSections.tsx`, word for word. */
const PAGE_TITLE = 'About';
const PAGE_DESCRIPTION =
  'See exactly what is deployed here: the version running, the commit it was built from, and when it was installed.';

/** Rendered in place of any fact the document does not carry. */
const UNKNOWN = 'Not recorded';

interface FactProps {
  label: string;
  children: ReactNode;
}

/**
 * One labelled fact, as a real `<dt>`/`<dd>` pair.
 *
 * A description list rather than a two-column `Grid` of `Typography`: every
 * value on this page is the answer to a named question, which is what a `<dl>`
 * means, and it is what lets a screen reader announce "Commit, 4f21ab9" as one
 * unit instead of two unrelated strings that happen to sit side by side.
 */
function Fact({ label, children }: FactProps) {
  return (
    <Fragment>
      <Box component="dt" sx={{ gridColumn: { xs: '1', sm: '1' }, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </Box>
      <Box component="dd" sx={{ gridColumn: { xs: '1', sm: '2' }, m: 0, minWidth: 0 }}>
        {children}
      </Box>
    </Fragment>
  );
}

/** A value that is text, or `UNKNOWN` when the document did not carry it. */
function Value({ value, mono = false }: { value: string | null; mono?: boolean }) {
  if (!value) {
    return (
      <Typography variant="body2" color="text.disabled">
        {UNKNOWN}
      </Typography>
    );
  }
  return (
    <Typography
      variant="body2"
      sx={{
        fontFamily: mono ? 'monospace' : undefined,
        // Long values (a SHA, a path, a domain) must wrap rather than widen the
        // page — this grid is the full width of a phone at `xs`.
        overflowWrap: 'anywhere',
      }}
    >
      {value}
    </Typography>
  );
}

/**
 * An absolute timestamp with its relative form beside it.
 *
 * BOTH, deliberately. "3 months ago" is the answer to "is this stale?" and the
 * absolute time is the one you correlate against a deploy log or an incident
 * timeline; on this page an operator routinely needs both in the same glance.
 */
function Timestamp({ value }: { value: string | null }) {
  if (!value) return <Value value={null} />;

  const parsed = new Date(value);
  const absolute = Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();

  return (
    <Typography variant="body2">
      {absolute}{' '}
      <Typography component="span" variant="body2" color="text.secondary">
        ({formatRelativeTime(value)})
      </Typography>
    </Typography>
  );
}

/** The `<dl>` itself — a two-column grid on `sm` and up, stacked on a phone. */
function FactList({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }) {
  return (
    <Box
      component="dl"
      {...rest}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, max-content) 1fr' },
        columnGap: 3,
        rowGap: 1.5,
        m: 0,
      }}
    >
      {children}
    </Box>
  );
}

function SectionPaper({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {children}
    </Paper>
  );
}

export default function AboutPage() {
  const { hasPermission } = usePermissions();
  const { data, isLoading, error, refresh } = useAbout();

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string, exactly as every sibling admin page does. It sits
  // after every hook so the hook order never changes.
  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  // `deployInfoStatus === 'ok'` is the ONLY test for "there are document facts
  // to render". It is deliberately not `&& run?.outcome === 'success'`: see the
  // file header — a failed run still wrote a complete document.
  const hasDocument = data?.deployInfoStatus === 'ok';
  const failedStep = data?.run?.outcome === 'failure' ? data.run.failedStep : null;
  const runFailed = data?.run?.outcome === 'failure';

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the registry card so the hub card, the
            rail row, the compact AppBar title and this `h1` all name the page
            identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          {PAGE_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {PAGE_DESCRIPTION}
        </Typography>

        {/* THE REQUEST FAILED — a 403, a network error, a maintenance window.
            NOT a missing or broken deploy document, and not a database that did
            not answer: the endpoint reports both of those as a successful 200
            and they render as facts below. */}
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            data-testid="about-request-error"
            action={
              <Button color="inherit" size="small" onClick={() => void refresh()}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {isLoading && !data && (
          <Stack direction="row" spacing={2} sx={{ py: 4, alignItems: 'center' }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Reading this deployment…</Typography>
          </Stack>
        )}

        {data && (
          <Stack spacing={3}>
            {/* ------------------------------------------------------------
                STATE 3 — a complete document describing a run that failed.
                ADDITIVE: every fact below still renders. The warning names the
                step so the operator knows which part of the deployment to
                distrust, rather than having to distrust all of it.
                ------------------------------------------------------------ */}
            {runFailed && (
              <Alert severity="warning" data-testid="about-run-failed">
                <AlertTitle>The deploy run that wrote this record failed</AlertTitle>
                {failedStep ? (
                  <>
                    It stopped at <strong>{failedStep}</strong>.{' '}
                  </>
                ) : (
                  'It did not record which step it stopped at. '
                )}
                Everything below is what that run did record, and it is accurate — the steps it
                completed really ran. Treat anything the failed step was responsible for as not
                done.
              </Alert>
            )}

            {/* ------------------------------------------------------------
                STATE 2 — no usable document.
                ⚠ THE COPY ASSERTS NOTHING about how this instance was
                deployed. See the file header. It states what the API knows —
                the status, and the exact path it read — and then lists the
                ordinary explanations without picking one.
                ------------------------------------------------------------ */}
            {!hasDocument && (
              <Alert severity="info" data-testid="about-no-record">
                <AlertTitle>
                  {data.deployInfoStatus === 'invalid'
                    ? 'The deployment record could not be read'
                    : 'No deployment record was found'}
                </AlertTitle>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {data.deployInfoStatus === 'invalid'
                    ? 'There is a file at the path this API looked at, and it could not be used:'
                    : 'Nothing was found at the path this API looked at:'}
                </Typography>
                <Typography
                  variant="body2"
                  component="p"
                  data-testid="about-deploy-info-path"
                  sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', mb: 1 }}
                >
                  {data.deployInfoPath}
                </Typography>
                {data.deployInfoError && (
                  <Typography
                    variant="body2"
                    data-testid="about-deploy-info-error"
                    sx={{ mb: 1 }}
                  >
                    {data.deployInfoError}
                  </Typography>
                )}
                <Typography variant="body2">
                  That path is the fact worth checking first: the record may be written somewhere
                  else, it may live on a mount that did not attach to this container, or a deploy
                  run may have stopped before it got as far as writing it. The version this API
                  reports for itself is below and is unaffected.
                </Typography>
              </Alert>
            )}

            {/* ------------------------------------------------------------
                THE FACTS. Rendered whenever a document was read — including
                when the run that wrote it failed (state 3).
                ------------------------------------------------------------ */}
            {hasDocument && (
              <SectionPaper title="This deployment">
                <FactList data-testid="about-deployment-facts">
                  <Fact label="Application">
                    <Value value={data.app?.name ?? null} />
                  </Fact>
                  <Fact label="Version">
                    <Value value={data.app?.version ?? null} />
                  </Fact>
                  <Fact label="Commit">
                    <Value value={data.app?.commitSha ?? null} mono />
                  </Fact>
                  <Fact label="Ref">
                    <Value value={data.app?.ref ?? null} mono />
                  </Fact>
                  <Fact label="Domain">
                    <Value value={data.domain} />
                  </Fact>
                  <Fact label="Installed">
                    <Timestamp value={data.installedAt} />
                  </Fact>
                  <Fact label="Last updated">
                    <Timestamp value={data.updatedAt} />
                  </Fact>
                  <Fact label="Deployed by">
                    <Value
                      value={
                        data.deployedBy?.cli
                          ? [data.deployedBy.cli, data.deployedBy.version]
                              .filter(Boolean)
                              .join(' ')
                          : null
                      }
                    />
                  </Fact>
                  <Fact label="Record read from">
                    {/* Shown on `ok` too, not only when it is missing: an
                        operator comparing two instances needs to know WHICH
                        file each one answered from. */}
                    <Value value={data.deployInfoPath} mono />
                  </Fact>
                </FactList>
              </SectionPaper>
            )}

            {/* ------------------------------------------------------------
                THE RUN — what the deploy actually did. Rendered for a
                successful run too: "which steps ran" is the other half of
                "what is deployed here".
                ------------------------------------------------------------ */}
            {hasDocument && data.run && (
              <SectionPaper title="Deploy run">
                <FactList data-testid="about-run-facts">
                  <Fact label="Outcome">
                    {data.run.outcome ? (
                      <Chip
                        size="small"
                        label={data.run.outcome === 'success' ? 'Succeeded' : 'Failed'}
                        color={data.run.outcome === 'success' ? 'success' : 'warning'}
                        variant="outlined"
                      />
                    ) : (
                      <Value value={null} />
                    )}
                  </Fact>
                  {failedStep && (
                    <Fact label="Failed at">
                      <Value value={failedStep} mono />
                    </Fact>
                  )}
                  <Fact label="Steps completed">
                    {data.run.completed.length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: 'wrap' }}
                        data-testid="about-run-steps"
                      >
                        {data.run.completed.map((step) => (
                          <Chip key={step} size="small" label={step} variant="outlined" />
                        ))}
                      </Stack>
                    ) : (
                      <Value value={null} />
                    )}
                  </Fact>
                </FactList>
              </SectionPaper>
            )}

            {/* ------------------------------------------------------------
                THE REMOTE — copied from the document, never refreshed. The
                caveat travels with the number because without `checkedAt` the
                number is unreadable: "4 commits behind" as of when?
                ------------------------------------------------------------ */}
            {hasDocument && data.remote && (
              <SectionPaper title="Against the remote">
                <FactList data-testid="about-remote-facts">
                  <Fact label="Commits behind">
                    <Value
                      value={
                        data.remote.commitsBehind === null
                          ? null
                          : String(data.remote.commitsBehind)
                      }
                    />
                  </Fact>
                  <Fact label="Checked">
                    <Timestamp value={data.remote.checkedAt} />
                  </Fact>
                </FactList>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                  Recorded when the deploy ran and never refreshed since — this page contacts
                  nothing. The count is as old as the time above says it is.
                </Typography>
              </SectionPaper>
            )}

            {/* ------------------------------------------------------------
                THIS API PROCESS. Always known, always rendered, never read
                from disk — so it is the one section that survives every
                failure the rest of the page can report.
                ------------------------------------------------------------ */}
            <SectionPaper title="This API process">
              <FactList data-testid="about-api-facts">
                <Fact label="API version">
                  <Value value={data.api.version} />
                </Fact>
              </FactList>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                The version the running process resolved for itself, independently of any
                deployment record. Compare it against the version in the user menu, which is baked
                into the page you are looking at — if the two disagree, this browser is holding a
                stale bundle.
              </Typography>
            </SectionPaper>

            {/* ------------------------------------------------------------
                THE DATABASE. `database: null` + `databaseError` is a 200 and a
                FACT — see the file header. It is reported here, scoped to this
                section, and never hoisted into the page-level error Alert.
                ------------------------------------------------------------ */}
            <SectionPaper title="Database">
              {data.database ? (
                <FactList data-testid="about-database-facts">
                  <Fact label="Status">
                    <Value value={data.database.status} />
                  </Fact>
                  <Fact label="Response time">
                    <Value value={data.database.responseTime || null} />
                  </Fact>
                </FactList>
              ) : (
                <Alert severity="warning" data-testid="about-database-error">
                  <AlertTitle>The database did not answer</AlertTitle>
                  {data.databaseError ??
                    'The probe failed and reported no reason. Everything else on this page is still accurate — it is read without the database.'}
                </Alert>
              )}
            </SectionPaper>

            <Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => void refresh()}
                disabled={isLoading}
              >
                Re-read
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                The record is read from disk on every request, so this picks up a deployment made
                since this page was opened without restarting anything.
              </Typography>
            </Box>
          </Stack>
        )}
      </Box>
    </Container>
  );
}
