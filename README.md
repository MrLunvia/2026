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

## Adron Video Engine: Seedance 2.5 video UI (Higgsfield API)

A local web app for making Seedance 2.5 videos through the Higgsfield API with the official [`@higgsfield/client`](https://www.npmjs.com/package/@higgsfield/client) SDK. Your API key stays on the server; the browser never sees it.

**Features**

- Any number of prompts per batch (up to 500), each up to **50,000 words**. Import `.txt`/`.md` scripts and **split long scripts into scenes** (at scene headings, `---` lines, or by paragraph), with an optional style prefix for every scene.
- **Image references** per prompt: a start frame (plus an optional end frame) for image-to-video, or up to 9 reference images to keep characters, products and style consistent. Add them by file picker, drag and drop, paste, or public URL; files upload to Higgsfield storage through the server.
- Output settings: duration 4–30 s, 480p or 720p, aspect ratio 21:9 to 9:16, audio on or off.
- Live generations panel: queued → generating → completed, with an inline player and download. Failed, moderated (`nsfw`) and canceled jobs are shown as such, never as successes. Cancel (while queued), retry, reuse and delete.
- Drafts autosave in the browser (IndexedDB); job history is kept in `data/jobs.json`.

**Run it on GitHub (nothing to install)**

1. Add your key once: on GitHub open **Settings → Codespaces → Secrets → New secret**, name it `HF_CREDENTIALS`, set the value to `key-id:key-secret`, and give it access to this repository.
2. [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/MrLunvia/2026?quickstart=1), or use **Code → Codespaces → Create codespace** on the branch that has this app.
3. Wait for setup to finish (a few minutes the first time). The app installs, builds, starts, and opens in a new browser tab. If no tab opens, open port 3000 from the **Ports** panel.

The app's address is private to your GitHub account. If you add or change the secret while a codespace is running, stop and restart the codespace. Stop it when you're done (GitHub → **Your codespaces**) so it doesn't use up your Codespaces hours.

**Run it on your computer**

1. `npm install`
2. `cp .env.example .env.local`, then set `HF_CREDENTIALS=key-id:key-secret` in `.env.local` (git-ignored; never commit it).
3. `npm run dev` (development, hot reload) or `npm run build && npm start` (production build).
4. Open http://127.0.0.1:3000

Every video is a separate billable request. Nothing is sent until you confirm the batch summary; batches of more than 10 videos need an extra acknowledgment. Jobs are submitted one at a time, a failed submission is never retried automatically, and nothing resumes after a server restart.

**Configuration** (environment or `.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `HF_CREDENTIALS` | none | Higgsfield key as `key-id:key-secret`. Without it the UI runs but cannot upload or generate. |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Where the server listens. There is no login, so keep it local or put your own authentication in front of it. |
| `ALLOWED_HOSTS` | none | Extra host names to accept (comma-separated) when serving under another name. |
| `DATA_DIR` | `data/` | Where job history is stored. |
| `HF_BASE_URL` | `https://api.higgsfield.ai` | API base URL, for proxies or testing. |

**How prompts map to Seedance 2.5** (`server/requests.ts`)

- Prompt only: `bytedance/seedance-2.5/text-to-video` with `prompt`, `duration`, `resolution`, `aspect_ratio`, `generate_audio`
- Start/end frame: `bytedance/seedance-2.5/image-to-video` with `image_url` and `end_image_url` (framing comes from the image)
- Reference images: `bytedance/seedance-2.5/reference-to-video` with `image_urls`

These workflow and field names have not been checked against Higgsfield's official model reference, which was unreachable when this was built. If Higgsfield rejects a field, the job shows the API's error message; options and limits live in `shared/options.ts`.

`npm run example` runs the original one-off CLI generation (`index.ts`, also billable), and `npm run typecheck` type-checks everything.
