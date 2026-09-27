/**
 * Seedance 2.5 text-to-video through the Higgsfield API, using the official
 * @higgsfield/client SDK (v2). Run with `npm start` - this is a billable request.
 *
 * Credentials come from HF_CREDENTIALS ("key-id:key-secret"), set in the
 * environment or in the git-ignored .env.local. The value is never printed.
 */
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  APIError,
  AuthenticationError,
  BadInputError,
  NotEnoughCreditsError,
  TimeoutError,
  ValidationError,
  createHiggsfieldClient,
} from '@higgsfield/client/v2';

const MODEL = 'bytedance/seedance-2.5/text-to-video';
const MAX_WAIT_MINUTES = 15;

// Values already set in the environment take precedence over .env.local.
loadEnv({ path: fileURLToPath(new URL('.env.local', import.meta.url)), quiet: true });

const credentials = process.env.HF_CREDENTIALS?.trim();
if (!credentials || !/^[^:\s]+:[^:\s]+$/.test(credentials)) {
  console.error(
    'HF_CREDENTIALS is missing or not in "key-id:key-secret" format.\n' +
      'Set it in .env.local (see .env.example) or in the environment, then run again.',
  );
  process.exit(1);
}

try {
  const client = createHiggsfieldClient({
    credentials,
    // Video jobs can take longer than the SDK's default 5-minute wait.
    maxPollTime: MAX_WAIT_MINUTES * 60_000,
    // The SDK retries failed submissions, which could start a second billable generation.
    maxRetries: 0,
  });

  console.log(`Submitting ${MODEL}; waiting up to ${MAX_WAIT_MINUTES} minutes for the result...`);
  const result = await client.subscribe(MODEL, {
    input: {
      prompt: 'A cinematic scene at sunset',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    },
    withPolling: true,
  });

  // Widened to string: the API can also report 'canceled', which the SDK's status type omits.
  const status: string = result.status;
  if (status === 'completed' && result.video?.url) {
    console.log(`Video URL: ${result.video.url}`);
  } else {
    console.error(`No video (request ${result.request_id}): ${describeStatus(status)}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

function describeStatus(status: string): string {
  switch (status) {
    case 'completed':
      return 'completed without a video URL';
    case 'failed':
      return 'generation failed';
    case 'nsfw':
      return 'rejected by content moderation';
    case 'canceled':
      return 'request was canceled';
    default:
      return `unexpected status "${status}"`;
  }
}

// Report curated fields only: raw axios errors (e.g. network failures) include the request config,
// Authorization header and all, so never print the error object itself.
function describeError(error: unknown): string {
  if (error instanceof TimeoutError) {
    // SDK 0.2.6 keeps polling a canceled request until maxPollTime, so cancellations also land here.
    return `No final status within ${MAX_WAIT_MINUTES} minutes; the request may still be running or may have been canceled. Check your Higgsfield console.`;
  }
  if (error instanceof AuthenticationError) {
    return 'Authentication failed (HTTP 401): check HF_CREDENTIALS.';
  }
  if (error instanceof NotEnoughCreditsError) {
    // The SDK maps every HTTP 403 to NotEnoughCreditsError.
    return 'HTTP 403: not enough credits, or access to api.higgsfield.ai was denied (for example by a network proxy).';
  }
  if (error instanceof ValidationError || error instanceof BadInputError) {
    return `Invalid input (HTTP ${error.statusCode}): ${error.message}`;
  }
  if (error instanceof APIError) {
    const body = error.responseData === undefined ? '' : ` ${JSON.stringify(error.responseData).slice(0, 500)}`;
    // SDK 0.2.6 also stops waiting on a transient 5xx while polling, so the job may still finish.
    const hint = (error.statusCode ?? 0) >= 500 ? ' The request may still be running; check your Higgsfield console.' : '';
    return `Higgsfield API error (HTTP ${error.statusCode ?? 'unknown'}): ${error.message}${body}${hint}`;
  }
  return `Request failed: ${error instanceof Error ? error.message : String(error)}`;
}
