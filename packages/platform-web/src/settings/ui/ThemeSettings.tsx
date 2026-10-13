import {
  Card,
  CardContent,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Box,
} from '@mui/material';
import {
  LightMode as LightIcon,
  DarkMode as DarkIcon,
  SettingsBrightness as SystemIcon,
} from '@mui/icons-material';
import type { ThemeOption, ThemePreferenceId } from '@marinoscar/platform-contract/settings';
import type { ComponentType } from 'react';

/**
 * What the `ExtraFields` slot of {@link ThemeSettings} receives.
 *
 * @stability experimental
 */
export interface ThemeExtraFieldsProps {
  /** The stored theme preference. */
  currentTheme: ThemePreferenceId;
  /** Reports a chosen preference (the card's own `onThemeChange`). */
  onThemeChange: (theme: ThemePreferenceId) => void;
  /** Whether the card is disabled (a save is in flight). */
  disabled: boolean;
}

/**
 * The replaceable parts of {@link ThemeSettings}. With none, the card is
 * exactly what it always was.
 *
 * @stability experimental
 */
export interface ThemeSettingsSlots {
  /** Rendered under the toggle (nothing by default): an app's own appearance fields, such as a density or an accent. */
  ExtraFields?: ComponentType<ThemeExtraFieldsProps>;
}

/**
 * Props of {@link ThemeSettings}.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface ThemeSettingsProps {
  /** The stored theme preference: light, dark, system, or an id an app registered. */
  currentTheme: ThemePreferenceId;
  /** Called with the chosen preference. */
  onThemeChange: (theme: ThemePreferenceId) => void;
  /** Disables the toggle (a save is in flight). */
  disabled?: boolean;
  /**
   * The themes an app registered (`themePreferenceOptions(settings)`), offered
   * after light, dark and system. Empty or absent: the three built-in choices.
   */
  extraOptions?: readonly ThemeOption[];
  /** Part overrides. */
  slots?: ThemeSettingsSlots;
}

/**
 * The light, dark or system choice, as a card.
 *
 * @param props - see {@link ThemeSettingsProps}.
 * @returns the card.
 *
 * @example
 * ```tsx
 * <ThemeSettings currentTheme="system" onThemeChange={(theme) => save({ theme })} />
 * ```
 *
 * @stability experimental
 */
export function ThemeSettings({
  currentTheme,
  onThemeChange,
  disabled = false,
  extraOptions,
  slots,
}: ThemeSettingsProps) {
  const ExtraFields = slots?.ExtraFields;
  const handleChange = (
    _event: React.MouseEvent<HTMLElement>,
    newTheme: ThemePreferenceId | null,
  ) => {
    if (newTheme !== null) {
      onThemeChange(newTheme);
    }
  };

  return (
    <Card id="theme">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Appearance
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose how the application looks to you
        </Typography>

        <ToggleButtonGroup
          value={currentTheme}
          exclusive
          onChange={handleChange}
          aria-label="theme selection"
          disabled={disabled}
          sx={{ mt: 1 }}
        >
          <ToggleButton value="light" aria-label="light mode">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
              <LightIcon />
              <span>Light</span>
            </Box>
          </ToggleButton>
          <ToggleButton value="dark" aria-label="dark mode">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
              <DarkIcon />
              <span>Dark</span>
            </Box>
          </ToggleButton>
          <ToggleButton value="system" aria-label="system preference">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
              <SystemIcon />
              <span>System</span>
            </Box>
          </ToggleButton>
          {extraOptions?.map((option) => (
            <ToggleButton key={option.id} value={option.id} aria-label={`${option.label} theme`}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                <span>{option.label}</span>
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {ExtraFields && (
          <ExtraFields currentTheme={currentTheme} onThemeChange={onThemeChange} disabled={disabled} />
        )}
      </CardContent>
    </Card>
  );
}
