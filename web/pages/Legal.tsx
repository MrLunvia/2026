/**
 * Terms, privacy, refund and contact pages. Payment providers (Razorpay especially) check that a store has these.
 * The wording is a starting template; the site owner should have it reviewed for their business and country.
 */
import type { ReactNode } from 'react';
import { PublicHeader, SiteFooter } from '../components/Chrome.tsx';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';

export type LegalPage = 'terms' | 'privacy' | 'refunds' | 'contact';

const UPDATED = '27 September 2026';

function Contact() {
  const { config } = useSession();
  const business = config?.business ?? {};
  return (
    <ul className="contact-list">
      {config?.supportEmail && (
        <li>
          <Icon name="mail" size={18} />
          <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>
        </li>
      )}
      {business.phone && (
        <li>
          <Icon name="user" size={18} />
          <a href={`tel:${business.phone.replace(/[^\d+]/g, '')}`}>{business.phone}</a>
        </li>
      )}
      {business.address && (
        <li>
          <Icon name="frames" size={18} />
          <span className="pre-line">
            {business.name && (
              <>
                {business.name}
                <br />
              </>
            )}
            {business.address}
          </span>
        </li>
      )}
    </ul>
  );
}

export function Legal({ page }: { page: LegalPage }) {
  const { config, user, money } = useSession();
  if (!config) return null;
  const app = config.appName;
  const who = config.business.name ?? app;
  const email = config.supportEmail;
  const mail = email ? <a href={`mailto:${email}`}>{email}</a> : 'our support address';
  const perVideo = money(config.pricing.perSecondCents['720p'] * 30);
  const processor =
    config.payments.provider === 'stripe' ? 'Stripe' : config.payments.provider === 'razorpay' ? 'Razorpay' : 'our payment processor';

  const pages: Record<LegalPage, { title: string; body: ReactNode }> = {
    terms: {
      title: 'Terms of Service',
      body: (
        <>
          <p>
            These terms are an agreement between you and {who} (“we”, “us”) for your use of {app}. By creating an account or buying
            credit you accept them.
          </p>
          <h2>1. The service</h2>
          <p>
            {app} creates videos with artificial intelligence from text prompts and images you provide. Videos are produced by
            third-party AI models; results vary and may not match your prompt exactly.
          </p>
          <h2>2. Your account</h2>
          <p>
            You must be at least 18 years old (or the age of majority where you live). Give accurate details, keep your password
            private, and tell us promptly if you think someone else has used your account. You are responsible for activity on it.
          </p>
          <h2>3. Credit and prices</h2>
          <p>
            {app} is prepaid: you buy credit and each video's price is deducted when it starts. Prices are in {config.pricing.currency}{' '}
            and are shown before you confirm (for example, {perVideo} for a 30-second 720p video). Credit does not expire, has no cash
            value, and can't be transferred. We may change prices for future videos; a change never affects a video already started.
            Payments are processed by {processor}; we never see or store your full card or bank details.
          </p>
          <h2>4. Refunds</h2>
          <p>
            Failed, blocked and canceled videos are refunded automatically. See the <Link to="/refunds">Refund &amp; Cancellation Policy</Link>{' '}
            for everything else.
          </p>
          <h2>5. Acceptable use</h2>
          <p>You must not use {app} to create, upload or request:</p>
          <ul>
            <li>sexual content involving minors, or any content that sexualizes or endangers children (we report it to the authorities);</li>
            <li>sexually explicit content or nudity;</li>
            <li>content showing a real person without their consent, or that impersonates or deceives (for example deepfakes or fake news);</li>
            <li>harassment, hate, threats, or graphic violence;</li>
            <li>content that infringes someone else's copyright, trademark or other rights;</li>
            <li>anything illegal where you or we are located.</li>
          </ul>
          <p>
            Every request passes an automatic content filter, which may block requests that look harmful even when they aren't; blocked
            requests are refunded. We may suspend accounts that break these rules.
          </p>
          <h2>6. Your content and videos</h2>
          <p>
            You keep whatever rights you have in your prompts and images, and you confirm you have the right to use them. You let us
            and our providers process them only to run the service. Subject to these terms, the law, and the usage rules of the AI models
            we use, you may use the videos you create. AI output can resemble other content, so check that your use doesn't infringe
            anyone's rights.
          </p>
          <h2>7. Availability</h2>
          <p>
            We work to keep {app} running, but it is provided “as is” and may sometimes be slow or unavailable, including because of our
            providers. We may change or discontinue features.
          </p>
          <h2>8. Liability</h2>
          <p>
            To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any claim
            is limited to the amount you paid us in the 12 months before it. Nothing here limits rights you have that can't be limited
            by law.
          </p>
          <h2>9. Ending your account</h2>
          <p>
            You can ask us to close your account at any time. We may suspend or close accounts that break these terms. If we close your
            account for any other reason, we refund your unused credit.
          </p>
          <h2>10. Changes and contact</h2>
          <p>
            We may update these terms and will show the new date here; continuing to use {app} after a change means you accept it.
            Questions: {mail}.
          </p>
        </>
      ),
    },
    privacy: {
      title: 'Privacy Policy',
      body: (
        <>
          <p>This policy explains what {who} collects when you use {app}, why, and your choices.</p>
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account details:</strong> your name, email address, and your password in scrambled (hashed) form.
            </li>
            <li>
              <strong>Your content:</strong> the prompts and images you submit and the videos created from them.
            </li>
            <li>
              <strong>Payments:</strong> amounts, dates, status and the payment processor's reference. Card, UPI and bank details go
              straight to {processor}; we never receive or store them.
            </li>
            <li>
              <strong>Technical data:</strong> your IP address and a session cookie, used to keep you logged in and to prevent abuse.
            </li>
          </ul>
          <h2>How we use it</h2>
          <p>
            To run the service (making your videos, keeping your balance), to process payments, to send account emails such as password
            resets, to prevent fraud and abuse, and to meet legal obligations. We don't sell your data and we don't use advertising
            trackers.
          </p>
          <h2>Who we share it with</h2>
          <p>
            Only the providers needed to run {app}: our AI video-generation provider (which receives your prompts and images to make
            the videos and stores the finished files), {processor} for payments, our email provider, and our hosting provider. We may
            disclose information when the law requires it.
          </p>
          <h2>Cookies</h2>
          <p>We use one essential cookie to keep you logged in. No analytics or advertising cookies.</p>
          <h2>How long we keep it</h2>
          <p>
            Account data and your video history are kept while your account is open. Payment records are kept as long as tax and
            accounting law requires. Ask us to delete your account and we'll delete your personal data except what we must keep by law.
          </p>
          <h2>Security</h2>
          <p>Passwords are hashed, the site uses HTTPS, and access to customer data is restricted.</p>
          <h2>Your rights</h2>
          <p>
            You can ask for a copy of your data, a correction, or deletion by emailing {mail}. {app} is not intended for anyone under 18.
          </p>
          <h2>Changes</h2>
          <p>We'll post any changes here with a new date.</p>
        </>
      ),
    },
    refunds: {
      title: 'Refund & Cancellation Policy',
      body: (
        <>
          <h2>Automatic refunds</h2>
          <p>
            If a video fails, is blocked by the content filter, or can't be started, its full price is returned to your {app} balance
            automatically. You'll see the refund under Account → Activity.
          </p>
          <h2>Cancellations</h2>
          <p>
            A video that is still waiting to start can be canceled from My videos for a full refund to your balance. Once generation has
            started it can't be canceled, because the processing cost has already been incurred.
          </p>
          <h2>Completed videos</h2>
          <p>
            Each video uses paid AI processing, so completed videos aren't refundable because you don't like the result. If a video is
            defective (for example the file is corrupted or blank), contact {mail} within 7 days with the video's details; if we confirm
            the problem we refund it to your balance.
          </p>
          <h2>Unused credit</h2>
          <p>
            You can ask for a refund of unused credit from a purchase within 7 days of buying it, as long as none of that purchase has
            been spent. Approved refunds go back to the original payment method, usually within 5–10 business days depending on your
            bank.
          </p>
          <h2>Delivery</h2>
          <p>
            {app} is a digital service; nothing is shipped. Credit is added to your account as soon as the payment is confirmed, and
            videos are delivered in your account (usually within minutes) where you can watch and download them.
          </p>
          <h2>Contact</h2>
          <p>Questions about a charge or refund: {mail}.</p>
        </>
      ),
    },
    contact: {
      title: 'Contact us',
      body: (
        <>
          <p>Questions about your account, a payment or a video? We usually reply within 1–2 business days.</p>
          <Contact />
          <p className="muted">For a specific video or payment, include the email address on your account.</p>
        </>
      ),
    },
  };
  const { title, body } = pages[page];

  return (
    <div className="site">
      <PublicHeader />
      <main className="page prose">
        {user?.isAdmin && page !== 'contact' && (
          <p className="banner banner-info">
            <Icon name="shield" size={16} />
            <span>
              Admin note: this is template wording. Have it reviewed for your business and country before launch, and set
              BUSINESS_NAME, BUSINESS_ADDRESS, SUPPORT_EMAIL and SUPPORT_PHONE on the server.
            </span>
          </p>
        )}
        <h1>{title}</h1>
        {page !== 'contact' && <p className="muted">Last updated {UPDATED}</p>}
        {body}
      </main>
      <SiteFooter />
    </div>
  );
}
