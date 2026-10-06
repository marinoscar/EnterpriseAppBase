// =============================================================================
// The Doctor page (issue #634; packaged by #696)
// =============================================================================
//
// The question it answers: is every capability configured, reachable and
// healthy? One row per check, grouped by category, with the remedy and a link
// to the settings page that fixes it.
//
// ⚠ A FAILING CHECK IS NOT A PAGE ERROR. The endpoint answers 200 with a
// `fail` verdict; that renders as the verdict Alert and the rows below it. The
// page-level error Alert is reserved for a request that actually failed.
//
// THE PAGE DOES NOT CHECK PERMISSIONS: the app's route gate does
// (`doctorSettingsPage.card.permission`). It never imports app context, layout
// or navigation; everything comes from `usePlatformHost()`, and links use
// react-router's `Link`.
//
// Deliberately NOT feature-gated: the page reports on AI and telemetry while
// they are switched off (as `skip`), which is precisely when an admin asks
// why a capability is missing.
// =============================================================================

import { useMemo, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  Skeleton,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import type { AlertColor, SxProps, Theme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useOptionalPlatformHost } from '../../core/index.js';
import {
  DOCTOR_STATUS_ORDER,
  PLATFORM_DOCTOR_CATEGORY_LABELS,
  categoryLabel,
  useDoctor,
} from '../headless/index.js';
import type { DoctorCategoryLabel, DoctorCheckReport, DoctorReport, DoctorStatus } from '../headless/index.js';
import { formatRelativeTime as fallbackRelativeTime } from '../internal/relative-time.js';
import { CheckRow, STATUS_LABELS, StatusIcon, statusChipSx } from './check-row.js';
import { DOCTOR_PAGE_DESCRIPTION, DOCTOR_PAGE_TITLE } from './copy.js';

/**
 * The props of {@link DoctorPageProps.slots}'s `Header`.
 *
 * @stability experimental
 */
export interface DoctorPageHeaderProps {
  /** The page title (the card's title). */
  title: string;
  /** The page subtitle (the card's description). */
  description: string;
}

/**
 * The props of {@link DoctorPage}. Every prop is optional; the app's route
 * renders `<DoctorPage />` as is.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface DoctorPageProps {
  /** Category display order and labels. Default `PLATFORM_DOCTOR_CATEGORY_LABELS`; unknown categories render after, title-cased. */
  categories?: readonly DoctorCategoryLabel[];
  /** Styles for the page's outer box. */
  sx?: SxProps<Theme>;
  /** Replaceable parts of the page. */
  slots?: {
    /** Replaces the title and subtitle block. */
    Header?: ComponentType<DoctorPageHeaderProps>;
  };
}

function isProblem(status: DoctorStatus): boolean {
  return status === 'warn' || status === 'fail';
}

function worstStatus(checks: DoctorCheckReport[]): DoctorStatus {
  let worst: DoctorStatus = 'pass';
  for (const check of checks) {
    if (DOCTOR_STATUS_ORDER.indexOf(check.status) > DOCTOR_STATUS_ORDER.indexOf(worst)) {
      worst = check.status;
    }
  }
  return worst;
}

interface CategoryGroup {
  key: string;
  label: string;
  checks: DoctorCheckReport[];
}

/** Known categories in display order, then unknown ones in the order the API sent them. */
function groupByCategory(checks: DoctorCheckReport[], labels: readonly DoctorCategoryLabel[]): CategoryGroup[] {
  const byKey = new Map<string, DoctorCheckReport[]>();
  for (const check of checks) {
    const list = byKey.get(check.category);
    if (list) list.push(check);
    else byKey.set(check.category, [check]);
  }
  const knownKeys = labels.map((category) => category.key);
  const ordered = [
    ...knownKeys.filter((key) => byKey.has(key)),
    ...[...byKey.keys()].filter((key) => !knownKeys.includes(key)),
  ];
  return ordered.map((key) => ({ key, label: categoryLabel(key, labels), checks: byKey.get(key) ?? [] }));
}

function countByStatus(checks: DoctorCheckReport[]): Record<DoctorStatus, number> {
  const counts: Record<DoctorStatus, number> = { pass: 0, skip: 0, warn: 0, fail: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function verdictSeverity(verdict: DoctorStatus): AlertColor {
  switch (verdict) {
    case 'fail':
      return 'error';
    case 'warn':
      return 'warning';
    case 'skip':
      return 'info';
    default:
      return 'success';
  }
}

function verdictTitle(report: DoctorReport, counts: Record<DoctorStatus, number>): string {
  const problems = counts.warn + counts.fail;
  if (problems > 0) {
    return problems === 1 ? '1 problem needs attention' : `${problems} problems need attention`;
  }
  if (counts.skip > 0 || report.verdict === 'skip') {
    return 'No problems found; some checks were skipped';
  }
  return 'All checks passed';
}

function formatReportDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function DefaultHeader({ title, description }: DoctorPageHeaderProps): ReactElement {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {description}
      </Typography>
    </>
  );
}

function LoadingSkeleton(): ReactElement {
  return (
    <Stack spacing={2} data-testid="doctor-loading" aria-busy="true" aria-label="Running checks">
      <Skeleton variant="rounded" height={72} />
      <Skeleton variant="rounded" height={32} width="60%" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} variant="rounded" height={56} />
      ))}
    </Stack>
  );
}

/**
 * The admin Doctor page: runs the checks, shows the verdict, the counts by
 * status, one accordion per category (problems expanded) and a "Problems only"
 * filter. Reads the app through `usePlatformHost()`; the app's route gates it.
 *
 * @param props - see {@link DoctorPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path={doctorSettingsPage.card.path} element={<DoctorPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function DoctorPage(props: DoctorPageProps = {}): ReactElement {
  const { categories = PLATFORM_DOCTOR_CATEGORY_LABELS, sx, slots } = props;
  const host = useOptionalPlatformHost();
  const formatRelativeTime = host?.formatRelativeTime ?? fallbackRelativeTime;
  const Header = slots?.Header ?? DefaultHeader;
  const { report, isLoading, error, rerun } = useDoctor();
  const [problemsOnly, setProblemsOnly] = useState(false);
  // Only the categories the admin has toggled; the rest follow the default
  // (expanded when they contain a problem), which re-derives on each run.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});

  const checks = useMemo(() => report?.checks ?? [], [report]);
  const counts = useMemo(() => countByStatus(checks), [checks]);
  // Grouped from ALL checks so each category's summary stays truthful; the
  // "Problems only" filter is applied per category below.
  const groups = useMemo(
    () =>
      groupByCategory(checks, categories)
        .map((group) => ({
          ...group,
          visible: problemsOnly ? group.checks.filter((check) => isProblem(check.status)) : group.checks,
        }))
        .filter((group) => group.visible.length > 0),
    [checks, categories, problemsOnly],
  );

  const handleRerun = () => {
    setExpandedOverrides({});
    void rerun();
  };

  return (
    <Container maxWidth="lg">
      <Box sx={[{ py: { xs: 2, sm: 4 } }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]} data-testid="doctor-page">
        <Header title={DOCTOR_PAGE_TITLE} description={DOCTOR_PAGE_DESCRIPTION} />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 2 }}
          sx={{ mb: 3, alignItems: { xs: 'stretch', sm: 'center' } }}
        >
          <Button
            variant="contained"
            onClick={handleRerun}
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
          >
            {isLoading ? 'Running checks…' : 'Run again'}
          </Button>
          {report && (
            <Typography variant="body2" color="text.secondary" data-testid="doctor-generated">
              Generated {formatRelativeTime(report.generatedAt)} · took {formatReportDuration(report.durationMs)}
            </Typography>
          )}
        </Stack>

        {/* THE REQUEST FAILED — never a failing check. */}
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            data-testid="doctor-request-error"
            action={
              <Button color="inherit" size="small" onClick={handleRerun} disabled={isLoading}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {isLoading && !report && <LoadingSkeleton />}

        {report && (
          <Stack spacing={3}>
            <Alert severity={verdictSeverity(report.verdict)} role="status" aria-live="polite" data-testid="doctor-verdict">
              <AlertTitle sx={{ mb: 0 }}>{verdictTitle(report, counts)}</AlertTitle>
            </Alert>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 1, sm: 2 }}
              sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
                aria-label="Checks by status"
                data-testid="doctor-summary"
              >
                {(['pass', 'warn', 'fail', 'skip'] as const).map((status) => (
                  <Chip
                    key={status}
                    size="small"
                    variant="outlined"
                    icon={<StatusIcon status={status} />}
                    sx={statusChipSx(status)}
                    label={`${STATUS_LABELS[status]}: ${counts[status]}`}
                    data-testid={`doctor-count-${status}`}
                  />
                ))}
              </Stack>
              <FormControlLabel
                control={<Switch checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />}
                label="Problems only"
              />
            </Stack>

            {groups.length === 0 && (
              <Typography color="text.secondary" data-testid="doctor-empty">
                {problemsOnly ? 'No warnings or failures.' : 'No checks were reported.'}
              </Typography>
            )}

            <Box>
              {groups.map((group) => {
                const worst = worstStatus(group.checks);
                const expanded = expandedOverrides[group.key] ?? isProblem(worst);
                const headingId = `doctor-category-${group.key}-heading`;
                const groupCounts = countByStatus(group.checks);
                return (
                  <Accordion
                    key={group.key}
                    expanded={expanded}
                    onChange={(_event, isExpanded) =>
                      setExpandedOverrides((previous) => ({ ...previous, [group.key]: isExpanded }))
                    }
                    disableGutters
                    data-testid={`doctor-category-${group.key}`}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      aria-controls={`doctor-category-${group.key}-content`}
                      id={headingId}
                    >
                      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                        <StatusIcon status={worst} />
                        <Typography variant="subtitle1" component="h2">
                          {group.label}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {groupCounts.pass}/{group.checks.length} passed
                        </Typography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails id={`doctor-category-${group.key}-content`}>
                      <Stack component="ul" spacing={2} sx={{ m: 0, p: 0 }}>
                        {group.visible.map((check) => (
                          <CheckRow key={check.id} check={check} />
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          </Stack>
        )}
      </Box>
    </Container>
  );
}
