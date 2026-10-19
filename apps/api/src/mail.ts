// Email through Resend's HTTP API (RESEND_API_KEY, MAIL_FROM). Without a key, development and the
// tests print the message to the server log and keep it in `outbox`; production only logs that
// nothing was sent, so a password-reset link never lands in the logs.

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const outbox: Mail[] = [];

export async function sendMail(mail: Mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') return console.error(`Email to ${mail.to} not sent: RESEND_API_KEY is not set`);
    if (outbox.push(mail) > 50) outbox.shift();
    return console.log(`Email (not sent: RESEND_API_KEY is not set) to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM ?? 'F&B Manager <onboarding@resend.dev>', to: mail.to, subject: mail.subject, text: mail.text }),
  });
  if (!res.ok) throw new Error(`Email to ${mail.to} could not be sent (${res.status}): ${await res.text()}`);
}

// The admin app's address, for links in emails. Never taken from the request, so a forged Host or
// Origin header cannot point a reset link at someone else's site.
export const appUrl = () =>
  process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173');
