import { Transform, type Readable } from 'node:stream';

import { PartSizeMismatchError } from '../providers/storage-provider.types';

/**
 * Wraps a request body so it carries EXACTLY `expectedSize` bytes, without ever holding more than one chunk.
 *
 * The returned stream passes bytes through unchanged and errors with
 * {@link PartSizeMismatchError} the moment the body runs past `expectedSize`
 * (`exceeded: true`, so the driver stops writing at once) or ends short
 * (`exceeded: false`). The size rule is therefore the platform's, whatever the
 * driver does: a driver's `uploadPart` only has to discard the part when its
 * input errors. When the body runs long the rest of the request is drained and
 * discarded so the 400 can still be sent on the connection.
 *
 * @param body - the request's raw body.
 * @param partNumber - the part, for the error.
 * @param expectedSize - the exact byte count.
 * @returns the bounded stream.
 *
 * @internal
 *
 * @stability experimental
 */
export function boundPartBody(body: Readable, partNumber: number, expectedSize: number): Readable {
  let seen = 0;

  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > expectedSize) {
        callback(new PartSizeMismatchError(partNumber, expectedSize, seen, true));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(seen === expectedSize ? null : new PartSizeMismatchError(partNumber, expectedSize, seen, false));
    },
  });

  bounded.once('error', () => {
    body.unpipe(bounded);
    body.resume();
  });
  body.once('error', (error) => bounded.destroy(error));

  return body.pipe(bounded);
}
