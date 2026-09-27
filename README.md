[GitHub-Setup-and-Repo-Guide.md](https://github.com/user-attachments/files/32158710/GitHub-Setup-and-Repo-Guide.md)
# 2026# GitHub Two-Profile Setup Guide

## 1. Structure: 1 Personal Account + 1 Organization

| | Personal Account | Organization |
|---|---|---|
| Name | Adnan Khan (your existing/main GitHub account) | Adron Media / Adron Flow |
| Holds | Business projects, academic work, general portfolio | AI tooling, Chrome extensions, automation products |
| Special repo for profile page | `YOUR_USERNAME/YOUR_USERNAME` (must match your username exactly) | `.github` repo → file at `profile/README.md` |

**Why this instead of 2 personal logins:** GitHub Organizations are free, get their own profile page + README, and are the intended way to separate a "brand" from your personal identity. Two personal accounts can look like sockpuppeting if they interact with the same repos/issues, and GitHub can flag it. This setup gives you the same visual result — two distinct profile pages — without that risk.

---

## 2. Setup Steps

**Personal profile README:**
1. Create a new repository named **exactly** your GitHub username (e.g. if your username is `adnankhan21`, repo name = `adnankhan21`).
2. Make it **Public**, check "Add a README file."
3. Delete the auto-generated README content and paste in `Adnan-Khan-Profile-README.md` (attached).
4. Commit — it will now show automatically on your profile page.

**Organization profile:**
1. GitHub → top-right `+` → **New organization** → choose the Free plan.
2. Name it `adron-media` or `adron-flow` (whichever handle is free).
3. Inside the org, create a repo named **`.github`** (Public, no README needed).
4. Inside that repo, create a folder `profile/` and a file `profile/README.md`.
5. Paste in `Adron-Media-Profile-README.md` (attached) — this becomes the org's profile page.

---

## 3. Full Repo Mapping

### Personal account (Adnan Khan)

| Project | Suggested repo name | Description | Suggested visibility |
|---|---|---|---|
| Lunvia Global Trade website | `lunvia-global-trade` | B2B import-export company website | Public |
| NewsFlow | `newsflow` | Automated multi-niche news aggregation web app | Public |
| Telegram store bot | `telegram-digital-store-bot` | Wallet + UPI/crypto storefront bot (python-telegram-bot v20) | **Private** (payment logic — strip real API keys before making public) |
| VIEWR pitch deck | `viewr-pitch-deck` | Investor pitch deck for watch-to-earn concept | Private (until you're ready to share) |
| DEKHO KHABAR branding | `dekho-khabar-branding` | News channel logo, lower thirds, thumbnail templates | Public |
| Kinja page assets | `kinja-media-assets` | Road-construction niche page assets | Private |
| BBA exam notes | `bba-exam-notes` | Exam-ready study notes across business subjects | Public (helps other students too) |

### Organization (Adron Media / Adron Flow)

| Project | Suggested repo name | Description | Suggested visibility |
|---|---|---|---|
| Adron Video Engine | `adron-video-engine` | React GUI unifying Higgsfield/Leonardo/ByteDance video-gen APIs | Public |
| Adron Flow Auto | `adron-flow-auto` | Google Flow (VEO/Imagen) automation extension | Public |
| Leonardo Bulk Automation | `leonardo-bulk-automation` | 50+ tab parallel Leonardo.ai automation | Public |
| Easy Scroll | `easy-scroll` | Auto-scroll/auto-like via Chrome Debugger API | Public |
| Price Tracker | `price-tracker-extension` | Multi-platform price monitoring | Public |
| Private Notepad | `private-notepad-extension` | Browser-only notepad extension | Public |
| Free Ad Blocker | `free-ad-blocker` | Chrome ad blocker with store assets | Public |
| Adron Auto-Edit | `adron-auto-edit` | FFmpeg-based video editor | Public |
| MetaStrip | `metastrip` | Image metadata remover | Public |
| Screen Translator | `screen-translator` | Dual Anthropic/OpenAI screen translation app | Public |
| Chrome Profile Bulk Generator | `chrome-profile-generator` | Bulk Chrome profile creation tool | Public |
| Chrome Tab Synchronizer | `chrome-tab-sync` | CDP-based tab synchronizer | Public |
| Photo Duplicator | `photo-duplicator` | Duplicate photo detection | Public |
| Screenshot Studio | `screenshot-studio` | Lossless PNG export, six frame styles | Public |
| AI Filmmaking Skill | `ai-filmmaking-skill` | Prompt system for Kling/Veo3/Seedance/Higgsfield/ElevenLabs/Suno | Public |
| Suno Skill Suite | `suno-skill-suite` | Genre-specific Suno.ai prompt generation system | Public |

**Pin these 6 on the org page for max impact:** Adron Video Engine, Leonardo Bulk Automation, AI Filmmaking Skill, Adron Auto-Edit, Suno Skill Suite, Adron Flow Auto.

**Pin these 6 on your personal page:** Lunvia Global Trade, NewsFlow, Telegram Store Bot (if public), BBA Exam Notes, DEKHO KHABAR Branding, and a link-repo to the org.

---

## 4. Before You Upload — .gitignore Templates

Drag-and-drop will happily upload `node_modules/` and `venv/` folders if you let it — that makes repos huge and slow. Create a `.gitignore` file **first** (upload it before the rest, or GitHub's web editor lets you add it via "Create new file" before the bulk upload).

**For React/Node projects (Adron Video Engine, etc.):**
```
node_modules/
dist/
build/
.env
.env.local
*.log
.DS_Store
```

**For Python projects (desktop tools, Telegram bot, etc.):**
```
__pycache__/
*.pyc
venv/
.env
*.sqlite3
dist/
build/
*.egg-info/
.DS_Store
```

---

## Adron Video Engine: a paid AI video platform (Seedance 2.5 via Higgsfield)

A website you can sell: customers sign up, buy credit, and turn long prompts and images into Seedance 2.5 videos made through the Higgsfield API. The default price is **$12.00 per 30-second 720p video** ($0.40 per second at 720p, $0.30 at 480p), and you can change it any time in the admin dashboard. Your Higgsfield and payment keys stay on the server; browsers never see them.

**For customers**

- Home page with features, pricing and FAQ; sign up, log in, password reset by email.
- Credit wallet: buy packs by card (Stripe) or UPI/cards/net banking (Razorpay). Credit never expires.
- Studio: prompts of up to **50,000 words**, `.txt` import and a scene splitter for long scripts, start/end frames or up to 9 reference images, 4–30 s, 480p/720p, six aspect ratios, sound on/off.
- The exact price is shown before anything is charged. Videos that fail, are blocked by the content filter, or are canceled before starting are **refunded automatically**.
- My videos (live progress, play, download), and an account page with every charge, refund and payment.
- Terms, Privacy, Refund & Cancellation and Contact pages (templates: have them reviewed for your business).

**For you (Admin, for the emails in `ADMIN_EMAILS`)**

- Revenue, customers, videos made, unspent customer credit.
- Customers: search, add or remove credit (for example after a bank transfer), disable accounts.
- Every video with the technical failure reason, and one-click refunds. Payments list. Prices, credit packs and sign-up bonus.
- If Higgsfield rejects the platform's key or your Higgsfield credit runs out, new videos wait in the queue (nobody is charged twice) and the dashboard says why.

**How the money works:** customers pay you through Stripe or Razorpay and get credit. Each video takes its price from their credit when it starts, and your Higgsfield account pays Higgsfield for the generation. Your margin is your price minus Higgsfield's cost, payment fees and taxes, so check Higgsfield's current price for a 30-second 720p Seedance 2.5 video before you pick yours. Also confirm that Higgsfield's API terms allow reselling generations, and that your payment account (Stripe/Razorpay KYC) is approved for this kind of digital service.

### Deploy on adronstore.in

This is a Node.js app with its own database file, so it needs a server that runs Docker (shared website hosting such as a WordPress/Shopify plan can't run it). A small VPS (1 vCPU, 1–2 GB RAM) is enough to start. The usual setup is a subdomain such as **video.adronstore.in**, so your current adronstore.in site keeps working and links to it.

1. **Server:** create an Ubuntu VPS (Hostinger VPS, DigitalOcean, AWS Lightsail, …) and install Docker: `curl -fsSL https://get.docker.com | sh`
2. **DNS:** where adronstore.in's DNS is managed, add an **A record**: name `video`, value = the VPS's IP address. (To use adronstore.in itself instead, point its A record at the VPS; the current site would then be replaced.)
3. **Get the code** on the server:
   ```bash
   git clone https://github.com/MrLunvia/2026.git adron && cd adron
   git checkout claude/higgsfield-seedance-setup-7y1811   # or the branch you merged it into
   cp .env.example .env && nano .env
   ```
   Fill in at least `HF_CREDENTIALS`, `ADMIN_EMAILS`, `PUBLIC_URL=https://video.adronstore.in`, `SUPPORT_EMAIL`, your business details, a payment provider, and `SMTP_URL`. `.env` is git-ignored; keep it only on the server.
4. **Start:** `docker compose up -d --build`. Caddy gets and renews the HTTPS certificate automatically (ports 80 and 443 must be open). Open https://video.adronstore.in and sign up with your admin email: the **Admin** tab appears.
5. **Payments** (use test mode first, then switch to live keys):
   - **Stripe:** Developers → Webhooks → add endpoint `https://video.adronstore.in/api/webhooks/stripe` with events `checkout.session.completed` and `checkout.session.async_payment_succeeded`; put the signing secret in `STRIPE_WEBHOOK_SECRET`.
   - **Razorpay:** Account & Settings → Webhooks → `https://video.adronstore.in/api/webhooks/razorpay` with events `payment.captured` and `order.paid`; put its secret in `RAZORPAY_WEBHOOK_SECRET`. To charge in rupees set `CURRENCY=INR` and prices in rupees (Razorpay needs international payments enabled for USD).
   - **Manual:** leave the keys empty, write `MANUAL_PAYMENT_NOTE` (for example your UPI ID), and add credit in Admin → Customers when someone pays.
6. **Backups:** `docker compose exec app npm run backup` copies the database (accounts, balances, payments) to `/data/backups` inside the `app-data` volume and keeps the newest 14. Run it daily from cron and copy the backups off the server.
7. **Updates:** `git pull && docker compose up -d --build` (data is kept in the volume). **Logs:** `docker compose logs -f app`.

Any other Docker host with a persistent volume works too (Railway, Render with a disk, Fly.io): run the `Dockerfile`, mount a volume at `/data`, set the variables from `.env.example`, and set `TRUST_PROXY=1` behind the host's proxy.

### Try it on GitHub or your computer

- **GitHub Codespaces:** add `HF_CREDENTIALS` (and `ADMIN_EMAILS`) under GitHub **Settings → Codespaces → Secrets**, then [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/MrLunvia/2026?quickstart=1). The app installs, builds and opens itself. Stop the codespace when you're done.
- **Your computer:** `npm install`, `cp .env.example .env.local` and fill it in, then `npm run dev` (or `npm run build && npm start`) and open http://127.0.0.1:3000.

Without payment keys the site runs in manual-payment mode, which is handy for trying things out: add credit to your own account from the Admin page. Every generated video is a real, billable Higgsfield request.

**Configuration:** every setting is listed with an explanation in [`.env.example`](.env.example). `npm run typecheck` type-checks everything; `npm run example` runs the original one-off CLI generation (`index.ts`, also billable).

**How prompts map to Seedance 2.5** (`server/requests.ts`)

- Prompt only: `bytedance/seedance-2.5/text-to-video` with `prompt`, `duration`, `resolution`, `aspect_ratio`, `generate_audio`
- Start/end frame: `bytedance/seedance-2.5/image-to-video` with `image_url` and `end_image_url` (framing comes from the image)
- Reference images: `bytedance/seedance-2.5/reference-to-video` with `image_urls`

These workflow and field names have not been checked against Higgsfield's official model reference, which was unreachable when this was built. If Higgsfield rejects a field, the video fails with the API's reason (shown to the admin) and the customer is refunded; options and limits live in `shared/options.ts`.
