import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DeleteOutlined as DeleteIcon } from '@mui/icons-material';
import type { ProfileImageSource, UserSettingsResponseBase } from '@marinoscar/platform-contract/settings';

import { isPlatformApiError } from '../../core/index.js';
import { useAuth } from '../../identity/index.js';
import { FeatureUnavailableNotice } from '../../onboarding/index.js';
import { TimeZoneField, timeZoneFromProfile } from '../../timezone/index.js';
import { useProfileImageClient } from '../headless/profile-image.js';
import type { ProfileImageMutationResponse } from '../headless/profile-image.js';
import { useStorageStatus } from '../headless/use-storage-status.js';
import { ImageUpload } from './ImageUpload.js';

/**
 * The profile fields a save may change. Beyond the core four (the time zone
 * among them: `null` clears it), a field an app added with `extendUserProfile`
 * (`pronouns`): `null` deletes it.
 *
 * @stability experimental
 */
export type ProfilePatch = Partial<Omit<UserSettingsResponseBase['profile'], 'timezone'>> & {
  timezone?: string | null;
} & Record<string, unknown>;

/** The core profile fields; every other key of a stored profile belongs to an app's `extendUserProfile`. */
const CORE_PROFILE_KEYS: readonly string[] = ['displayName', 'imageSource', 'imageObjectId', 'timezone'];

/**
 * What the `ExtraFields` slot of {@link ProfileSettings} receives: the app's
 * own profile fields, drawn inside the card and saved with its button.
 *
 * @stability experimental
 */
export interface ProfileExtraFieldsProps {
  /** The stored profile, the app's fields included. */
  profile: UserSettingsResponseBase['profile'] & Record<string, unknown>;
  /**
   * The values to show: what is stored, with the edits not saved yet on top.
   * Only the fields an app added (never `displayName` or the picture).
   */
  values: Readonly<Record<string, unknown>>;
  /** Sets one field; `undefined`, `null` or `''` clears it (the save sends `null`). */
  onChange: (name: string, value: unknown) => void;
  /** Whether the card is disabled (a save or an upload is in flight). */
  disabled: boolean;
}

/**
 * The replaceable parts of {@link ProfileSettings}. With none, the card is
 * exactly what it always was.
 *
 * @stability experimental
 */
export interface ProfileSettingsSlots {
  /** Rendered under the display name (nothing by default): the fields an app added to the profile. */
  ExtraFields?: ComponentType<ProfileExtraFieldsProps>;
}

/**
 * Props of {@link ProfileSettings}.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface ProfileSettingsProps {
  /** The stored profile preferences. */
  profile: UserSettingsResponseBase['profile'] & Record<string, unknown>;
  /**
   * PATCH the changed profile fields (display name, picture source, time zone).
   * Save through `useUserSettings` (as `UserProfilePage` does) so the display
   * zone follows a saved `timezone`; another transport calls
   * `setPreferredTimeZone` itself after a successful save.
   */
  onSave: (profile: ProfilePatch) => Promise<void>;
  /**
   * Adopt the settings document the upload/remove endpoints return, so the
   * stored `version` stays current, and optionally announce success.
   */
  onSettingsReplaced?: (settings: UserSettingsResponseBase, successMessage?: string) => void;
  /** Disables every control (a save is in flight). */
  disabled?: boolean;
  /** Part overrides. */
  slots?: ProfileSettingsSlots;
}

/** A cleared control: nothing to store. */
function isCleared(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * The PATCH of the app's own fields: every touched field whose value differs
 * from the stored one, `null` for a cleared one.
 */
function extraPatchOf(stored: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(draft)) {
    const before = stored[name];
    if (isCleared(value)) {
      if (!isCleared(before)) patch[name] = null;
    } else if (JSON.stringify(value) !== JSON.stringify(before)) {
      patch[name] = value;
    }
  }
  return patch;
}

interface SourceOption {
  value: ProfileImageSource;
  title: string;
  description: string;
  imageUrl: string | null;
  disabled: boolean;
}

/**
 * The profile card: display name, picture source (none, provider, upload),
 * preview, upload and remove.
 *
 * @param props - see {@link ProfileSettingsProps}.
 * @returns the card.
 *
 * @example
 * ```tsx
 * <ProfileSettings profile={settings.profile} onSave={(profile) => save({ profile }, msgs)} />
 * ```
 *
 * @stability experimental
 */
export function ProfileSettings({
  profile,
  onSave,
  onSettingsReplaced,
  disabled = false,
  slots,
}: ProfileSettingsProps) {
  const ExtraFields = slots?.ExtraFields;
  const { user, refreshUser } = useAuth();
  const baseId = useId();
  const profileImage = useProfileImageClient();

  // `?? 'provider'` only guards a settings document from an older API that
  // predates `imageSource`; the current contract always sends it.
  const savedSource: ProfileImageSource = profile.imageSource ?? 'provider';
  const hasUpload = Boolean(profile.imageObjectId);

  const [displayName, setDisplayName] = useState(profile.displayName || '');
  // `profile.timezone`: an IANA id, or `null` to follow the device.
  const savedTimeZone = timeZoneFromProfile(profile);
  const [timeZone, setTimeZone] = useState<string | null>(savedTimeZone);
  // The app's own profile fields (`ExtraFields`): the stored ones, and the
  // edits not saved yet (only the fields the user touched).
  const storedExtras = useMemo(
    () => Object.fromEntries(Object.entries(profile).filter(([key]) => !CORE_PROFILE_KEYS.includes(key))),
    [profile],
  );
  const storedExtrasKey = JSON.stringify(storedExtras);
  const [extraDraft, setExtraDraft] = useState<Record<string, unknown>>({});
  const [imageSource, setImageSource] = useState<ProfileImageSource>(savedSource);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // An uploaded picture is a storage object. When storage is known not to be
  // configured, a notice replaces the upload control that would fail; an
  // unknown answer changes nothing.
  const storage = useStorageStatus();
  // Object URL for the uploaded picture's preview. The public avatar route only
  // serves a picture while it is the SELECTED source, so the preview is loaded
  // through the authenticated `GET /user-settings/profile-image` instead and
  // rendered from a blob. The ref tracks the live URL so it can be revoked.
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const uploadPreviewUrlRef = useRef<string | null>(null);
  // Bumped after an upload or removal to force a re-fetch of the preview.
  const [uploadPreviewNonce, setUploadPreviewNonce] = useState(0);

  const replaceUploadPreview = useCallback((next: string | null) => {
    const previous = uploadPreviewUrlRef.current;
    uploadPreviewUrlRef.current = next;
    if (previous && previous !== next) {
      URL.revokeObjectURL(previous);
    }
    setUploadPreviewUrl(next);
  }, []);

  useEffect(
    () => () => {
      if (uploadPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadPreviewUrlRef.current);
        uploadPreviewUrlRef.current = null;
      }
    },
    [],
  );

  const hasUploadedImage = Boolean(user?.hasUploadedProfileImage);

  useEffect(() => {
    if (!hasUploadedImage) {
      replaceUploadPreview(null);
      return;
    }
    let cancelled = false;
    profileImage
      .preview()
      .then((blob) => {
        if (!cancelled) replaceUploadPreview(URL.createObjectURL(blob));
      })
      .catch(() => {
        // No stored picture (404) or a network failure: the option simply
        // shows initials. Not worth an error banner.
        if (!cancelled) replaceUploadPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasUploadedImage, uploadPreviewNonce, replaceUploadPreview, profileImage]);

  // Sync each field from the stored document only when THAT field changes, so
  // an upload (which replaces the document) does not discard a display name
  // the user has typed but not saved yet.
  useEffect(() => {
    setDisplayName(profile.displayName || '');
  }, [profile.displayName]);

  useEffect(() => {
    setImageSource(savedSource);
  }, [savedSource]);

  useEffect(() => {
    setTimeZone(savedTimeZone);
  }, [savedTimeZone]);

  // A saved (or replaced) document supersedes the edits.
  useEffect(() => {
    setExtraDraft({});
  }, [storedExtrasKey]);

  const providerUrl = user?.providerProfileImageUrl ?? null;
  const uploadedUrl = hasUpload ? uploadPreviewUrl : null;

  const urlFor = (source: ProfileImageSource): string | null => {
    if (source === 'provider') return providerUrl;
    if (source === 'upload') return uploadedUrl;
    return null;
  };

  // Choosing "Upload" before any picture exists is a UI state, not a saveable
  // one: the API rejects `imageSource: 'upload'` without an upload, and the
  // upload endpoint sets the source itself once it succeeds.
  const awaitingUpload = imageSource === 'upload' && !hasUpload;
  const effectiveSource = awaitingUpload ? savedSource : imageSource;
  const extraPatch = extraPatchOf(storedExtras, extraDraft);
  const hasChanges =
    displayName !== (profile.displayName || '') ||
    effectiveSource !== savedSource ||
    timeZone !== savedTimeZone ||
    Object.keys(extraPatch).length > 0;

  const isBusy = isSaving || isUploading || isRemoving;
  const controlsDisabled = disabled || isBusy;

  const initials =
    user?.displayName
      ?.split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ||
    user?.email?.[0]?.toUpperCase() ||
    '?';

  const options: SourceOption[] = [
    {
      value: 'none',
      title: 'No picture',
      description: 'Show your initials instead',
      imageUrl: null,
      disabled: false,
    },
    {
      value: 'provider',
      title: 'Picture from your sign-in provider',
      description: providerUrl
        ? 'Use the picture from the account you signed in with'
        : "Your sign-in provider didn't supply a picture",
      imageUrl: providerUrl,
      disabled: !providerUrl,
    },
    {
      value: 'upload',
      title: 'Upload a picture',
      description: hasUpload
        ? 'Use the picture you uploaded'
        : 'Choose an image from your device',
      imageUrl: uploadedUrl,
      disabled: false,
    },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const patch: ProfilePatch = { displayName: displayName || undefined, ...extraPatch };
      if (effectiveSource !== savedSource) {
        patch.imageSource = effectiveSource;
      }
      if (timeZone !== savedTimeZone) {
        patch.timezone = timeZone;
      }
      // The display-zone store follows the saved document: `useUserSettings`
      // pushes `profile.timezone` on every successful save (`syncTimeZone`).
      await onSave(patch);
      // Refresh user to get the newly resolved profile picture and name
      await refreshUser();
    } finally {
      setIsSaving(false);
    }
  };

  const refreshUserQuietly = async () => {
    try {
      await refreshUser();
    } catch {
      // The picture change itself succeeded; a failed refresh only leaves the
      // avatar stale until the next load.
    }
  };

  const handleUploaded = async (result: ProfileImageMutationResponse, file: File) => {
    setImageError(null);
    setImageSource(result.settings.profile.imageSource);
    // Adopt the new settings (and `version`) before anything cosmetic can fail.
    onSettingsReplaced?.(result.settings, 'Profile picture updated');
    // Show the picked file straight away; the re-fetch below replaces it with
    // what the server actually stored.
    try {
      replaceUploadPreview(URL.createObjectURL(file));
    } catch {
      // Preview only; the re-fetch still runs.
    }
    await refreshUserQuietly();
    setUploadPreviewNonce((n) => n + 1);
  };

  const handleRemoveUpload = async () => {
    setConfirmRemoveOpen(false);
    setIsRemoving(true);
    setImageError(null);
    try {
      const result = await profileImage.remove();
      replaceUploadPreview(null);
      setImageSource(result.settings.profile.imageSource);
      onSettingsReplaced?.(result.settings, 'Uploaded picture removed');
      await refreshUserQuietly();
      setUploadPreviewNonce((n) => n + 1);
    } catch (err) {
      setImageError(
        isPlatformApiError(err) && err.message !== 'Request failed'
          ? err.message
          : 'Failed to remove the uploaded picture. Please try again.',
      );
    } finally {
      setIsRemoving(false);
    }
  };

  const previewCaption = awaitingUpload
    ? 'Upload a picture to use it. Nothing changes until the upload finishes.'
    : effectiveSource !== savedSource
      ? 'Save changes to start using this picture.'
      : 'This is how you appear across the app.';

  const labelId = `${baseId}-source-label`;
  const removeTitleId = `${baseId}-remove-title`;
  const removeDescId = `${baseId}-remove-desc`;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Profile
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Customize how you appear to others
        </Typography>

        <Stack spacing={3}>
          {/* Current selection preview */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
          >
            <Avatar
              src={urlFor(imageSource) ?? undefined}
              alt={`Profile picture preview for ${user?.displayName || user?.email || 'you'}`}
              sx={{ width: 80, height: 80, fontSize: '1.75rem' }}
            >
              {initials}
            </Avatar>
            <Box>
              <Typography variant="subtitle2">Preview</Typography>
              <Typography variant="body2" color="text.secondary" aria-live="polite">
                {previewCaption}
              </Typography>
            </Box>
          </Stack>

          {/* Picture source */}
          <FormControl component="fieldset" disabled={controlsDisabled}>
            <FormLabel component="legend" id={labelId}>
              Profile picture
            </FormLabel>
            <RadioGroup
              aria-labelledby={labelId}
              name="profile-image-source"
              value={imageSource}
              onChange={(e) => {
                setImageError(null);
                setImageSource(e.target.value as ProfileImageSource);
              }}
            >
              {options.map((option) => {
                const descriptionId = `${baseId}-source-${option.value}-desc`;
                return (
                  <FormControlLabel
                    key={option.value}
                    value={option.value}
                    // MUI's FormControlLabel prefers its own `disabled` over
                    // the fieldset's, so a literal `false` here would re-enable
                    // the option while the page is disabled or busy.
                    disabled={controlsDisabled || option.disabled}
                    sx={{ mr: 0, my: 0.5, alignItems: 'center' }}
                    control={
                      <Radio
                        slotProps={{ input: { 'aria-describedby': descriptionId } }}
                      />
                    }
                    label={
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Avatar
                          src={option.imageUrl ?? undefined}
                          alt=""
                          aria-hidden
                          sx={{ width: 40, height: 40, fontSize: '1rem', flexShrink: 0 }}
                        >
                          {initials}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body1">{option.title}</Typography>
                          <Typography
                            id={descriptionId}
                            variant="body2"
                            color="text.secondary"
                          >
                            {option.description}
                          </Typography>
                        </Box>
                      </Stack>
                    }
                  />
                );
              })}
            </RadioGroup>
            {awaitingUpload && (
              <FormHelperText>
                Your current picture stays in place until an upload succeeds.
              </FormHelperText>
            )}
          </FormControl>

          {(imageSource === 'upload' || hasUpload) && (
            <Stack spacing={1.5} sx={{ pl: { xs: 0, sm: 5 } }}>
              {imageSource === 'upload' && storage.configured === false && (
                <FeatureUnavailableNotice feature="storage" detail="You can still use the picture from your sign-in provider, or none." />
              )}
              {imageSource === 'upload' && storage.configured !== false && (
                <ImageUpload
                  onUploaded={handleUploaded}
                  onUploadingChange={setIsUploading}
                  disabled={disabled || isSaving || isRemoving}
                  label={hasUpload ? 'Replace picture' : 'Upload picture'}
                />
              )}
              {hasUpload && (
                <Box>
                  <Button
                    variant="text"
                    color="error"
                    size="small"
                    startIcon={<DeleteIcon />}
                    onClick={() => setConfirmRemoveOpen(true)}
                    disabled={controlsDisabled}
                  >
                    {isRemoving ? 'Removing...' : 'Remove uploaded picture'}
                  </Button>
                </Box>
              )}
            </Stack>
          )}

          {imageError && (
            <Alert severity="error" onClose={() => setImageError(null)}>
              {imageError}
            </Alert>
          )}

          {/* Display Name */}
          <TextField
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={user?.email?.split('@')[0]}
            helperText="Leave empty to use your Google name"
            disabled={disabled}
            fullWidth
          />

          {/* Time zone: every time the app shows is rendered in it. */}
          <TimeZoneField value={timeZone} onChange={setTimeZone} disabled={controlsDisabled} />

          {ExtraFields && (
            <ExtraFields
              profile={profile as ProfileExtraFieldsProps['profile']}
              values={{ ...storedExtras, ...extraDraft }}
              onChange={(name, value) => setExtraDraft((draft) => ({ ...draft, [name]: value }))}
              disabled={controlsDisabled}
            />
          )}

          {/* Email (read-only) */}
          <TextField
            label="Email"
            value={user?.email || ''}
            disabled
            fullWidth
            helperText="Email cannot be changed"
          />

          {/* Save Button */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={disabled || !hasChanges || isBusy}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Box>
        </Stack>
      </CardContent>

      <Dialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        aria-labelledby={removeTitleId}
        aria-describedby={removeDescId}
      >
        <DialogTitle id={removeTitleId}>Remove uploaded picture?</DialogTitle>
        <DialogContent>
          <DialogContentText id={removeDescId}>
            The picture you uploaded will be deleted.
            {savedSource === 'upload' &&
              " Your profile will switch to your sign-in provider's picture."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
          <Button color="error" onClick={handleRemoveUpload}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
