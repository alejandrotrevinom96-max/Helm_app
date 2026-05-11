// PR #58 — Sprint 7.0.2: thin Resend wrapper.
//
// Returns success: false silently when RESEND_API_KEY isn't set so
// the cron handler can keep running without throwing — we don't want
// a missing key to break sync-metrics.
//
// `from` defaults to a generic sender. The Resend dashboard requires
// the sending domain (trythelm.com) to be verified or this returns
// a 403 — that's a one-time DNS setup the founder needs to do.
import { Resend } from 'resend';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

const DEFAULT_FROM = 'Helm <weekly@trythelm.com>';

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      success: false,
      error: 'RESEND_API_KEY not configured',
    };
  }
  try {
    const resend = new Resend(key);
    const res = await resend.emails.send({
      from: args.from ?? DEFAULT_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
    });
    if (res.error) {
      return { success: false, error: res.error.message };
    }
    return { success: true, id: res.data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
