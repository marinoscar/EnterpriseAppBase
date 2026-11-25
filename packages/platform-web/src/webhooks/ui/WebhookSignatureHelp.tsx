// "Verifying signatures" (issue #1046): how a receiver checks a delivery,
// with the contract's own helper. Static text; nothing is sent anywhere.

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material';
import type { ReactElement } from 'react';

import { WEBHOOK_HEADERS } from '@marinoscar/platform-contract/webhooks';

/**
 * The Node snippet the help panel shows: verify a delivery with
 * `verifyWebhookSignature` from `@marinoscar/platform-contract/webhooks`.
 *
 * @stability experimental
 */
export const WEBHOOK_VERIFY_SNIPPET = `import { verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

// Read the RAW body: verify before parsing JSON.
app.post('/hook', express.raw({ type: 'application/json' }), async (req, res) => {
  const ok = await verifyWebhookSignature({
    secret: process.env.WEBHOOK_SECRET, // whsec_...
    id: req.get('${WEBHOOK_HEADERS.ID}'),
    timestamp: req.get('${WEBHOOK_HEADERS.TIMESTAMP}'),
    signatureHeader: req.get('${WEBHOOK_HEADERS.SIGNATURE}'),
    body: req.body.toString('utf8'),
  });
  if (!ok) return res.status(401).end();
  const event = JSON.parse(req.body.toString('utf8'));
  // Deduplicate on event.id: a retry carries the same id.
  res.status(204).end();
});`;

/**
 * The collapsible "Verifying signatures" help panel.
 *
 * @returns the panel.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhookSignatureHelp(): ReactElement {
  return (
    <Accordion variant="outlined" disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="webhook-signature-help" id="webhook-signature-help-header">
        <Typography variant="subtitle1" component="h2">
          Verifying signatures
        </Typography>
      </AccordionSummary>
      <AccordionDetails id="webhook-signature-help">
        <Typography variant="body2" sx={{ mb: 1 }}>
          Every delivery carries <code>{WEBHOOK_HEADERS.ID}</code>, <code>{WEBHOOK_HEADERS.TIMESTAMP}</code> and{' '}
          <code>{WEBHOOK_HEADERS.SIGNATURE}</code> headers (the Standard Webhooks scheme): an HMAC-SHA256 of{' '}
          <code>{'id.timestamp.body'}</code> made with the endpoint&apos;s signing secret. While a rotated secret is
          still accepted, the signature header holds two entries; accept either.
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Reject a delivery whose signature does not verify or whose timestamp is more than five minutes old, and
          deduplicate on the event id, which stays the same across retries.
        </Typography>
        <Box
          component="pre"
          aria-label="Signature verification example"
          tabIndex={0}
          sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', fontSize: 13, overflowX: 'auto' }}
        >
          {WEBHOOK_VERIFY_SNIPPET}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
