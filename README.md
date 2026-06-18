# The Doc Mirror

Doctor Visibility Audit SaaS — thedocmirror.com

## Quick start

**Windows:** Double-click `setup-and-start.bat`

**Mac / Linux:** Run in terminal:
```bash
bash setup-and-start.sh
```

Or manually:
```bash
cd dev-package
npm install
cp config/.env.example config/.env.local   # then fill in your API keys
node server.js
```

Open http://localhost:3000

## Sharing this project as a ZIP

**Do NOT include `node_modules`** when creating the ZIP — it's 300MB+ and contains OS-specific binaries that won't work on other machines.

Correct way to ZIP:
- Windows: right-click the folder → Send to → Compressed folder — but first **delete `dev-package/node_modules`**
- Or use git: `git archive --format=zip HEAD > docmirror.zip`

The person receiving the ZIP runs `setup-and-start.bat` (Windows) or `bash setup-and-start.sh` (Mac/Linux) and `npm install` downloads everything fresh, including Puppeteer's Chromium.

## PDF generation

Puppeteer downloads its own Chromium automatically during `npm install`.
No Chrome installation or `CHROME_PATH` setup required.

If you want to use a specific Chrome binary, add this to `config/.env.local`:
```
CHROME_PATH=/path/to/chrome
```

## Environment variables

Copy `dev-package/config/.env.example` to `dev-package/config/.env.local` and fill in:

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Yes | Doctor lookup + competitor data |
| `ANTHROPIC_API_KEY` | Yes | AI-written report sections |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Yes | Payments |
| `NEXT_PUBLIC_SUPABASE_URL` + keys | Yes | Database |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Yes | Email delivery |

## Deploy to Vercel

```bash
git add .
git commit -m "your message"
git push origin main
```

Set all env vars in Vercel dashboard → Project → Settings → Environment Variables.
Requires **Vercel Pro** for PDF generation (needs 120s function timeout).
