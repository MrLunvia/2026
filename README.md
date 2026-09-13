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

**Critical:** Never upload real API keys, tokens, or `.env` files with live credentials (Telegram bot token, payment gateway keys, Anthropic/OpenAI keys). Replace them with placeholders in a `.env.example` file before uploading.

---

## 5. Drag-and-Drop Upload — Step by Step

1. **Create the repository** — github.com → `+` (top right) → New repository → name it per the table above → choose Public/Private → do **not** check "Add README" if your project already has one.
2. **Open the repo** → click **Add file** → **Upload files**.
3. **Drag the entire project folder** from File Explorer straight into the browser drop zone. Modern GitHub preserves folder structure automatically.
4. Scroll down, write a commit message (e.g. "Initial upload"), click **Commit changes**.
5. **For projects with `node_modules`/`venv`:** upload the `.gitignore` file *first* as a separate small commit, then upload the rest — otherwise the upload will try to include those huge folders and may time out or exceed the 100-file/25MB-per-file web-upload limit.
6. **For anything bigger than that limit** (large video-engine builds, big datasets): install **GitHub Desktop** (free, no command line needed) — you can literally drag your project folder onto the GitHub Desktop window, it detects it as a new repo, and you click "Publish repository." Same drag-and-drop feel, no file-size ceiling.
7. Once uploaded, go to repo **Settings → General** (or the gear icon near "About" on the repo page) and add **Topics** (e.g. `chrome-extension`, `automation`, `react`, `ai-video`) — this makes your work discoverable and makes the profile look intentional, not just a dump of folders.

---

## 6. Final Polish Checklist

- [ ] Every repo has a one-paragraph description (the "About" gear icon on each repo page)
- [ ] Every repo has 2-4 topic tags
- [ ] Both profile READMEs are live and linking to each other
- [ ] 6 repos pinned on each profile (personal + org)
- [ ] No real API keys/tokens committed anywhere — check with `git log -p | grep -i "key\|token\|secret"` locally if you ever move to CLI, or just eyeball each file before upload
- [ ] Org has a logo/avatar uploaded (Settings → Organization profile)
