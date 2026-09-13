import { useEffect, useId, useState } from 'react';
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
import { useAuth } from '../../contexts/AuthContext';
import { ApiError, deleteProfileImage } from '../../services/api';
import type {
  ProfileImageMutationResponse,
  ProfileImageSource,
  UserSettings,
  UserSettingsUpdate,
} from '../../types';
import { ImageUpload } from './ImageUpload';

type ProfilePatch = NonNullable<UserSettingsUpdate['profile']>;

interface ProfileSettingsProps {
  profile: UserSettings['profile'];
  /** PATCH the changed profile fields (display name and/or picture source). */
  onSave: (profile: ProfilePatch) => Promise<void>;
  /**
   * Adopt the settings document the upload/remove endpoints return, so the
   * stored `version` stays current, and optionally announce success.
   */
  onSettingsReplaced?: (settings: UserSettings, successMessage?: string) => void;
  disabled?: boolean;
}

interface SourceOption {
  value: ProfileImageSource;
  title: string;
  description: string;
  imageUrl: string | null;
  disabled: boolean;
}

export function ProfileSettings({
  profile,
  onSave,
  onSettingsReplaced,
  disabled = false,
}: ProfileSettingsProps) {
  const { user, refreshUser } = useAuth();
  const baseId = useId();

  // `?? 'provider'` only guards a settings document from an older API that
  // predates `imageSource`; the current contract always sends it.
  const savedSource: ProfileImageSource = profile.imageSource ?? 'provider';
  const hasUpload = Boolean(profile.imageObjectId);

  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [imageSource, setImageSource] = useState<ProfileImageSource>(savedSource);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // The just-uploaded URL, used until `refreshUser()` brings the new
  // `uploadedProfileImageUrl` so the preview does not flash the old picture.
  const [pendingUploadUrl, setPendingUploadUrl] = useState<string | null>(null);

  // Sync each field from the stored document only when THAT field changes, so
  // an upload (which replaces the document) does not discard a display name
  // the user has typed but not saved yet.
  useEffect(() => {
    setDisplayName(profile.displayName || '');
  }, [profile.displayName]);

  useEffect(() => {
    setImageSource(savedSource);
  }, [savedSource]);

  const providerUrl = user?.providerProfileImageUrl ?? null;
  const uploadedUrl = hasUpload
    ? pendingUploadUrl ?? user?.uploadedProfileImageUrl ?? null
    : null;

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
  const hasChanges =
    displayName !== (profile.displayName || '') || effectiveSource !== savedSource;

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
      const patch: ProfilePatch = { displayName: displayName || undefined };
      if (effectiveSource !== savedSource) {
        patch.imageSource = effectiveSource;
      }
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

  const handleUploaded = async (result: ProfileImageMutationResponse) => {
    setImageError(null);
    setPendingUploadUrl(result.profileImageUrl);
    setImageSource(result.settings.profile.imageSource);
    onSettingsReplaced?.(result.settings, 'Profile picture updated');
    await refreshUserQuietly();
    setPendingUploadUrl(null);
  };

  const handleRemoveUpload = async () => {
    setConfirmRemoveOpen(false);
    setIsRemoving(true);
    setImageError(null);
    try {
      const result = await deleteProfileImage();
      setPendingUploadUrl(null);
      setImageSource(result.settings.profile.imageSource);
      onSettingsReplaced?.(result.settings, 'Uploaded picture removed');
      await refreshUserQuietly();
    } catch (err) {
      setImageError(
        err instanceof ApiError && err.message !== 'Request failed'
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
                    disabled={option.disabled}
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
              {imageSource === 'upload' && (
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
