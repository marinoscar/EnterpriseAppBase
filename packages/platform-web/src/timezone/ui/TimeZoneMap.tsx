// The world map of the time zone picker: a dot-matrix land layer, the UTC
// offset band of the selected zone, every zone as a tiny pin, the selected one
// as a pulsing ring, a hover preview on fine pointers and an offset axis.
// Tap or click anywhere picks the nearest zone. The land and the band are SVG
// in map units (one unit = one degree), so they scale to any width; the pins,
// the label and the axis are HTML placed by percentage, so they keep their
// pixel size on a phone and on a wide desktop.

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Box, Paper, Typography, useMediaQuery } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import {
  TIME_ZONE_MAP_HEIGHT,
  TIME_ZONE_MAP_WIDTH,
  findTimeZone,
  formatTime,
  formatUtcOffset,
  landDotsPath,
  listTimeZones,
  nearestZone,
  offsetBandRanges,
  projectToMap,
  unprojectFromMap,
} from '../headless/index.js';
import type { TimeZoneOption } from '../headless/index.js';
import { useNow } from '../internal/use-now.js';

/**
 * Props of {@link TimeZoneMap}.
 *
 * @stability experimental
 */
export interface TimeZoneMapProps {
  /** The selected zone id: its offset band and its ring pin. `null` draws neither. */
  value: string | null;
  /** Called with the zone nearest a click or tap. Without it the map only shows. */
  onChange?: (id: string) => void;
  /** The zones to pin; default {@link listTimeZones}. */
  zones?: readonly TimeZoneOption[];
  /** The accessible description; default names the selection. */
  'aria-label'?: string;
  /** Style overrides of the outer box. */
  sx?: SxProps<Theme>;
}

const pulse = keyframes`
  0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0.75; }
  80%, 100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
`;

const VIEW_BOX = `0 0 ${TIME_ZONE_MAP_WIDTH} ${TIME_ZONE_MAP_HEIGHT}`;
const HOURS = Array.from({ length: 25 }, (_, i) => i - 12);

function pct(value: number, of: number): string {
  return `${((value / of) * 100).toFixed(3)}%`;
}

function tickLabel(hours: number): string {
  if (hours === 0) return '0';
  return hours < 0 ? `−${-hours}` : `+${hours}`;
}

/** The theme colors of the map, in light and dark mode. */
function mapColors(theme: Theme) {
  const dark = theme.palette.mode === 'dark';
  const band = theme.palette.secondary.main;
  return {
    surface: dark ? alpha(theme.palette.common.white, 0.03) : alpha(theme.palette.primary.main, 0.035),
    land: alpha(theme.palette.primary.main, dark ? 0.38 : 0.4),
    landInBand: dark ? theme.palette.secondary.light : theme.palette.secondary.dark,
    grid: alpha(theme.palette.text.primary, dark ? 0.045 : 0.045),
    bandFill: alpha(band, dark ? 0.2 : 0.14),
    bandEdge: alpha(band, dark ? 0.9 : 0.75),
    pin: alpha(theme.palette.text.primary, dark ? 0.4 : 0.28),
    ring: band,
  };
}

/**
 * The time zone world map. Purely presentational: `value` in, the nearest zone
 * to a click or tap out (`onChange`). It is one image to assistive technology
 * (`role="img"`, labelled with the selection); the accessible way to pick a
 * zone is the picker's search field, so pins are not tab stops.
 *
 * @param props - see {@link TimeZoneMapProps}.
 * @returns the map.
 *
 * @example
 * ```tsx
 * <TimeZoneMap value={pending} onChange={setPending} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function TimeZoneMap({ value, onChange, zones, 'aria-label': ariaLabel, sx }: TimeZoneMapProps) {
  const theme = useTheme();
  const colors = mapColors(theme);
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const reactId = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const now = useNow(30_000);

  const options = useMemo(() => zones ?? listTimeZones(), [zones]);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const land = useMemo(() => landDotsPath(), []);
  const pinsPath = useMemo(
    () =>
      options
        .filter((option) => option.lat !== null && option.lon !== null)
        .map((option) => {
          const { x, y } = projectToMap(option.lon as number, option.lat as number);
          return `M${x.toFixed(2)} ${y.toFixed(2)}h0`;
        })
        .join(''),
    [options],
  );

  const selected = useMemo(() => (value ? (byId.get(value) ?? findTimeZone(value)) : null), [byId, value]);
  const hovered = hoverId && hoverId !== value ? (byId.get(hoverId) ?? null) : null;
  const bands = selected ? offsetBandRanges(selected.offsetMinutes) : [];
  const clipId = `tz-band-${reactId}`;

  /** The map coordinate under a pointer, through the SVG's own transform. */
  const toLonLat = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    let x: number;
    let y: number;
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const local = point.matrixTransform(ctm.inverse());
      x = local.x;
      y = local.y;
    } else {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      x = ((clientX - rect.left) / rect.width) * TIME_ZONE_MAP_WIDTH;
      y = ((clientY - rect.top) / rect.height) * TIME_ZONE_MAP_HEIGHT;
    }
    return unprojectFromMap(x, y);
  }, []);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const at = toLonLat(event.clientX, event.clientY);
    if (at) onChange(nearestZone(at.lon, at.lat));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onChange || event.pointerType === 'touch') return;
    const at = toLonLat(event.clientX, event.clientY);
    const id = at ? nearestZone(at.lon, at.lat) : null;
    if (id !== hoverId) setHoverId(id);
  };

  const label =
    ariaLabel ??
    (selected
      ? `World time zone map. Selected: ${selected.city}${selected.countryName ? `, ${selected.countryName}` : ''}, ${selected.offsetLabel}.`
      : 'World time zone map. No time zone selected.');

  const selectedPoint = selected && selected.lat !== null && selected.lon !== null ? projectToMap(selected.lon, selected.lat) : null;
  const hoveredPoint = hovered && hovered.lat !== null && hovered.lon !== null ? projectToMap(hovered.lon, hovered.lat) : null;
  const tickStep = narrow ? 4 : 2;
  const selectedHours = selected ? selected.offsetMinutes / 60 : null;
  const selectedTickX = selectedHours !== null ? Math.min(TIME_ZONE_MAP_WIDTH, Math.max(0, selectedHours * 15 + 180)) : null;

  return (
    <Box sx={[{ width: '100%', userSelect: 'none' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box
        data-testid="time-zone-map"
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverId(null)}
        sx={{
          position: 'relative',
          borderRadius: 2,
          bgcolor: colors.surface,
          cursor: onChange ? 'crosshair' : 'default',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={VIEW_BOX}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={label}
          style={{ display: 'block', height: 'auto', overflow: 'visible' }}
        >
          <defs>
            <clipPath id={clipId}>
              {bands.map(([x, width]) => (
                <rect key={x} x={x} y={0} width={width} height={TIME_ZONE_MAP_HEIGHT} />
              ))}
            </clipPath>
          </defs>
          {/* Hour boundaries: the faint stripes the band snaps between. */}
          <path
            d={HOURS.slice(0, -1)
              .map((h) => `M${h * 15 + 187.5} 0V${TIME_ZONE_MAP_HEIGHT}`)
              .join('')}
            stroke={colors.grid}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
          {bands.map(([x, width]) => (
            <g key={x} data-testid="time-zone-band">
              <rect x={x} y={0} width={width} height={TIME_ZONE_MAP_HEIGHT} fill={colors.bandFill} />
              {x > 0 && <line x1={x} x2={x} y1={0} y2={TIME_ZONE_MAP_HEIGHT} stroke={colors.bandEdge} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
              {x + width < TIME_ZONE_MAP_WIDTH && (
                <line x1={x + width} x2={x + width} y1={0} y2={TIME_ZONE_MAP_HEIGHT} stroke={colors.bandEdge} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
            </g>
          ))}
          <path d={land} stroke={colors.land} strokeWidth={1.02} strokeLinecap="round" fill="none" />
          {bands.length > 0 && (
            <path d={land} stroke={colors.landInBand} strokeWidth={1.02} strokeLinecap="round" fill="none" clipPath={`url(#${clipId})`} />
          )}
          <path d={pinsPath} stroke={colors.pin} strokeWidth={0.9} strokeLinecap="round" fill="none" />
        </svg>

        {hoveredPoint && hovered && (
          <>
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: pct(hoveredPoint.x, TIME_ZONE_MAP_WIDTH),
                top: pct(hoveredPoint.y, TIME_ZONE_MAP_HEIGHT),
                width: 10,
                height: 10,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                bgcolor: 'text.primary',
                border: 2,
                borderColor: 'background.paper',
                pointerEvents: 'none',
              }}
            />
            <ZoneLabel option={hovered} x={hoveredPoint.x} y={hoveredPoint.y} now={now} />
          </>
        )}

        {selectedPoint && (
          <Box
            aria-hidden
            data-testid="time-zone-selected-pin"
            sx={{
              position: 'absolute',
              left: pct(selectedPoint.x, TIME_ZONE_MAP_WIDTH),
              top: pct(selectedPoint.y, TIME_ZONE_MAP_HEIGHT),
              width: 0,
              height: 0,
              pointerEvents: 'none',
              '&::before, &::after': {
                content: '""',
                position: 'absolute',
                left: 0,
                top: 0,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
              },
              '&::before': {
                width: 14,
                height: 14,
                bgcolor: colors.ring,
                border: 2.5,
                borderColor: theme.palette.common.white,
                boxShadow: `0 0 0 1.5px ${colors.ring}, 0 2px 6px ${alpha(theme.palette.common.black, 0.4)}`,
                zIndex: 1,
              },
              '&::after': {
                width: 22,
                height: 22,
                border: 2,
                borderColor: colors.ring,
                animation: `${pulse} 2.2s cubic-bezier(0.2, 0.6, 0.35, 1) infinite`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.45 },
              },
            }}
          />
        )}
      </Box>

      {/* The offset axis: -12 ... +12 hours, the selected offset called out. */}
      <Box aria-hidden sx={{ position: 'relative', height: 30, mt: 0.75 }}>
        {HOURS.filter((h) => h % tickStep === 0).map((h) => {
          const x = h * 15 + 180;
          const near = selectedHours !== null && Math.abs(h - selectedHours) < (narrow ? 2.6 : 1.6);
          return (
            <Box
              key={h}
              sx={{
                position: 'absolute',
                left: pct(x, TIME_ZONE_MAP_WIDTH),
                top: 0,
                transform: h === -12 ? 'none' : h === 12 ? 'translateX(-100%)' : 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: h === -12 ? 'flex-start' : h === 12 ? 'flex-end' : 'center',
                opacity: near ? 0 : 1,
                transition: 'opacity 150ms',
              }}
            >
              <Box sx={{ width: '1px', height: 5, bgcolor: 'divider' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
                {tickLabel(h)}
              </Typography>
            </Box>
          );
        })}
        {selected && selectedTickX !== null && (
          <Box
            sx={{
              position: 'absolute',
              left: pct(selectedTickX, TIME_ZONE_MAP_WIDTH),
              top: 2,
              transform: `translateX(${selectedTickX < 25 ? '0' : selectedTickX > TIME_ZONE_MAP_WIDTH - 25 ? '-100%' : '-50%'})`,
              px: 1,
              py: 0.125,
              borderRadius: 999,
              bgcolor: colors.ring,
              color: theme.palette.getContrastText(colors.ring),
              typography: 'caption',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatUtcOffset(selected.offsetMinutes)}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** The hover label: city, country, offset and the local time, flipped away from the edges. */
function ZoneLabel({ option, x, y, now }: { option: TimeZoneOption; x: number; y: number; now: Date }) {
  const alignX = x < TIME_ZONE_MAP_WIDTH * 0.18 ? '0%' : x > TIME_ZONE_MAP_WIDTH * 0.82 ? '-100%' : '-50%';
  const below = y < TIME_ZONE_MAP_HEIGHT * 0.3;
  return (
    <Paper
      elevation={6}
      role="presentation"
      sx={{
        position: 'absolute',
        left: pct(x, TIME_ZONE_MAP_WIDTH),
        top: pct(y, TIME_ZONE_MAP_HEIGHT),
        transform: `translate(${alignX}, ${below ? '14px' : 'calc(-100% - 14px)'})`,
        px: 1.25,
        py: 0.75,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 2,
        borderRadius: 1.5,
      }}
    >
      <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
        {option.city}
        {option.countryName && option.countryName !== option.city ? (
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
            {`, ${option.countryName}`}
          </Typography>
        ) : null}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
        {`${option.offsetLabel} · ${formatTime(now, { timeZone: option.id })}`}
      </Typography>
    </Paper>
  );
}
