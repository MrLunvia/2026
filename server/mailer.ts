/** Outgoing email (password resets). SMTP_URL=log prints messages to the terminal for local testing. */
import nodemailer from 'nodemailer';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(smtp: { url: string; from: string } | undefined): Mailer | undefined {
  if (!smtp) return undefined;
  if (smtp.url === 'log') {
    return {
      async send(to, subject, text) {
        console.log(`--- email to ${to}: ${subject}\n${text}\n---`);
      },
    };
  }
  const transport = nodemailer.createTransport(smtp.url);
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
