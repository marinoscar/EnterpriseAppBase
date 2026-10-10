/**
 * The app's sign-in button looks (#727, PP-6.6): the reference example of the
 * web `registerAuthProvider` seam. The package already knows how Google,
 * Microsoft and GitHub look; an app registers any other provider its API
 * enables (`registerAuthProvider` of `@marinoscar/platform-api/identity`) so
 * the login page renders a proper button for it. A provider the API does not
 * offer never renders, so registering one is safe before it is switched on.
 *
 * Imported once, for its effect, by `main.tsx`.
 */
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import { registerAuthProvider } from '@marinoscar/platform-web/identity/headless';

registerAuthProvider({ id: 'oidc', label: 'Continue with SSO', Icon: KeyOutlinedIcon });
