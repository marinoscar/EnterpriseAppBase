/**
 * The app's login page (#727, PP-6.6): the packaged `LoginPage` with this
 * app's own parts in its slots, the reference example of the slot seam
 * ("packages own behaviour, apps own appearance"). The package owns the flow
 * (redirect when signed in, the session-expired notice, one button per
 * provider the API offers); the app owns what its footer says.
 *
 * The footer renders the same caption as the package default, so the page is
 * pixel-identical to the one before the move; a fork puts its legal links here.
 */
import { Typography } from '@mui/material';
import { LoginPage } from '@marinoscar/platform-web/identity/ui';

function AppLoginFooter() {
  return (
    <Typography variant="caption" color="text.secondary">
      By signing in, you agree to our Terms of Service and Privacy Policy
    </Typography>
  );
}

const LOGIN_SLOTS = { Footer: AppLoginFooter };

export default function AppLoginPage() {
  return <LoginPage slots={LOGIN_SLOTS} />;
}
