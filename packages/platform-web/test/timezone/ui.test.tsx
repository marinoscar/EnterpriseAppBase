// The time zone picker dialog, the map and the compact field of `timezone/ui`.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceTimeZone, setPreferredTimeZone } from '../../src/timezone/headless/index.js';
import { TimeZoneField, TimeZoneMap, TimeZonePickerDialog } from '../../src/timezone/ui/index.js';
import { setViewportWidth } from '../viewport.js';

const theme = createTheme();
const renderUi = (ui: ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

afterEach(() => setPreferredTimeZone(null));

describe('TimeZonePickerDialog', () => {
  it('searches, selects and reports the zone on Save only', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderUi(<TimeZonePickerDialog open value="America/Costa_Rica" onClose={onClose} onSelect={onSelect} />);
    expect(screen.getByRole('dialog', { name: 'Select your time zone' })).toBeInTheDocument();
    expect(screen.getByTestId('time-zone-summary-title')).toHaveTextContent('Costa Rica');

    await userEvent.type(screen.getByRole('combobox', { name: 'Search time zones' }), 'Tokyo');
    await userEvent.click(await screen.findByRole('option', { name: /Tokyo/ }));
    expect(screen.getByTestId('time-zone-summary-title')).toHaveTextContent('Tokyo');
    expect(onSelect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSelect).toHaveBeenCalledWith('Asia/Tokyo');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('finds a zone by its offset', async () => {
    renderUi(<TimeZonePickerDialog open value={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Search time zones' }), 'UTC+5:30');
    expect(await screen.findByRole('option', { name: /Kolkata/ })).toBeInTheDocument();
  });

  it('maps Automatic to null, and the device button to the device zone', async () => {
    const onSelect = vi.fn();
    renderUi(<TimeZonePickerDialog open value="Asia/Tokyo" onClose={vi.fn()} onSelect={onSelect} />);
    const automatic = screen.getByRole('switch', { name: /Automatic/ });
    expect(automatic).not.toBeChecked();
    await userEvent.click(automatic);
    expect(screen.getByTestId('time-zone-summary-title')).toHaveTextContent('Automatic');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);

    await userEvent.click(screen.getByRole('button', { name: /Use this device's time zone/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSelect).toHaveBeenLastCalledWith(deviceTimeZone());
  });

  it('cancels without reporting', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderUi(<TimeZonePickerDialog open value={null} onClose={onClose} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is full screen below sm, with a close button', () => {
    act(() => setViewportWidth(390));
    renderUi(<TimeZonePickerDialog open value={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(document.querySelector('.MuiDialog-paperFullScreen')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('is a centred dialog at desktop width', () => {
    renderUi(<TimeZonePickerDialog open value={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(document.querySelector('.MuiDialog-paperFullScreen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});

describe('TimeZoneMap', () => {
  it('is one labelled image showing the band and the pin of the selection', () => {
    renderUi(<TimeZoneMap value="America/Costa_Rica" />);
    expect(screen.getByRole('img', { name: /Selected: Costa Rica, Costa Rica, UTC−06:00/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('time-zone-band')).toHaveLength(1);
    expect(screen.getByTestId('time-zone-selected-pin')).toBeInTheDocument();
  });

  it('picks the zone nearest a click', () => {
    const onChange = vi.fn();
    renderUi(<TimeZoneMap value={null} onChange={onChange} />);
    const svg = screen.getByRole('img') as unknown as SVGSVGElement;
    // jsdom has no layout: a 720 x 285 map at the origin, two pixels per degree.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 720, height: 285, right: 720, bottom: 285, x: 0, y: 0, toJSON: () => ({}) });
    // Tokyo: 139.7E 35.7N -> x = (139.7 + 180) * 2, y = (84 - 35.7) * 2.
    fireEvent.click(screen.getByTestId('time-zone-map'), { clientX: 639.4, clientY: 96.6 });
    expect(onChange).toHaveBeenCalledWith('Asia/Tokyo');
  });
});

describe('TimeZoneField', () => {
  it('reads out the choice and saves a new one through the lazy dialog', async () => {
    const onChange = vi.fn();
    renderUi(<TimeZoneField value="America/Costa_Rica" onChange={onChange} />);
    expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(/^America\/Costa_Rica · UTC−06:00 · /);

    await userEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Select your time zone' });
    await userEvent.click(within(dialog).getByRole('switch', { name: /Automatic/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says when it follows the device', () => {
    renderUi(<TimeZoneField value={null} onChange={vi.fn()} />);
    expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(`Automatic — follows this device (${deviceTimeZone()})`);
  });

  it('disables the link', () => {
    renderUi(<TimeZoneField value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Change time zone' })).toBeDisabled();
  });
});
