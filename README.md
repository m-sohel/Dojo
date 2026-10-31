# Dojo — Java workspace

A calm, local-first Java editor and runner for DSA practice. Code is saved in this browser. You can run Java locally with a JDK, or configure a hosted Judge0-compatible service so visitors do not need Java installed. There are no accounts, ads, or analytics in the app.

## Local development requirements

- Node.js 20 or newer and npm
- JDK 17 or newer, with `javac` and `java` available on your `PATH` (only needed for the local runner)

Check the Java installation with `javac -version` and `java -version`.

## Run locally

1. Open a terminal in the project directory.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Start the frontend and local runner:

   ```sh
   npm run dev
   ```

4. Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`).

For a production-style local run, use `npm run build` and then `npm start`; open `http://127.0.0.1:3001`.

## Install as an app

Build and start the production-style local app (`npm run build`, then `npm start`) and open `http://127.0.0.1:3001` in a supported browser. Select **Install** in the top bar, or use the browser's install option. On iPhone or iPad, open the site in Safari and choose **Share → Add to Home Screen**. Installation requires HTTPS or localhost; the development server does not register the offline app shell.

The installed app caches its frontend shell and editor assets for offline opening. Running Java still requires the local Node server and JDK to be running; API requests are never cached.

## Using the workspace

- Write a solution in `Main.java`; the starter includes a `Scanner` for standard input.
- Put test data in the Input panel and select **Run**, or press **Ctrl/Cmd + Enter**.
- Hold **Ctrl** (or **Cmd** on macOS) and scroll over the editor to zoom its text. Font size is also available in Settings and is saved in this browser.
- Drag the divider to resize the editor and panels. Use the layout control to change between side-by-side and stacked panes.
- Change appearance with the sun/moon control. Theme, layout, and code are saved in local storage.
- Settings include font size, downloading `Main.java`, and resetting the starter. Focus mode is available from the bottom-right control or **Ctrl/Cmd + Shift + F**; press **Esc** to leave.

## Themes

Choose **Slate**, **Moss**, **Dusk**, or **Sand** with the four top-bar color dots, then use the sun/moon button to switch light or dark mode. The app defaults to Slate and the operating system color mode. Your choices are saved in `localStorage` as `theme` and `mode`; an early head script applies them before the app renders. Monaco syntax and editor colors follow the same CSS tokens.

How to add a new theme: add its light/dark token block pair in `src/themes.css`, register its name in `src/theme.js`, then add its accent swatch token and one `.theme-dot[data-theme-option="name"]` rule in `src/themes.css` and `src/styles.css`.

Theme-related files:

- `index.html` — early theme initialization before render.
- `src/themes.css` — shared tokens and all eight theme/mode palettes.
- `src/theme.js` — theme/mode setters and local-storage persistence.
- `src/ThemeControls.jsx` — accessible theme picker and mode toggle.
- `src/main.jsx` — token-based Monaco theme synchronization; replaced the prior theme state.
- `src/styles.css` — replaced interface color literals with theme tokens.

## Hosting for visitors without Java

Visitors do **not** need Java installed. The app always sends code to `/api/run`; Java runs on the configured execution service, not on the visitor's device.

## Deploy to Vercel without Docker

The project now has a standard Vercel Node.js Function at `/api/run`; Vercel builds and serves the Vite frontend from `dist`. No Docker installation, JDK, or Java runtime is needed on your computer for deployment or on visitors' devices. Java source is sent from the function to the hosted Judge0-compatible runner.

1. Push this project to GitHub and import `m-sohel/Dojo` in the Vercel dashboard.
2. Before deploying, open the Vercel project **Settings → Environment Variables** and add the Judge0 variables below for every environment you will use (Production, and Preview if needed). Keep keys private; do not use `VITE_` prefixes.
3. Deploy from Vercel. The included `vercel.json` selects `npm run build`, serves `dist`, and allows up to 45 seconds for a hosted run.
4. Visit `/api/health` on the deployment. It should report `"runner":"hosted"`. If it reports `"unconfigured"`, add `JUDGE0_API_URL` and redeploy. Submit a small program through the app to verify the configured Judge0 endpoint and key.
5. Before sharing it publicly, enable Vercel Firewall rate limiting for `POST /api/run` and configure request quotas with your Judge0 provider. The in-memory limit in the local Express server does not apply to separate Vercel Function instances.

For public hosting, use a hosted Judge0-compatible service. Configure these environment variables on the **server only**:

- `JUDGE0_API_URL` — your provider's base URL, such as `https://judge0-ce.p.rapidapi.com`
- `JUDGE0_API_KEY` — the provider key, if required
- `JUDGE0_API_HOST` — the RapidAPI host header, if required
- `JUDGE0_AUTH_HEADER` — optional key header name; defaults to `X-RapidAPI-Key`

Vercel's GitHub integration builds and deploys this directly; Docker is optional. The existing Node-only Docker image is an alternative if you later choose a container host:

```sh
docker build -t dojo .
docker run --rm -p 3001:3001 \
  -e JUDGE0_API_URL=https://your-judge0-host \
  -e JUDGE0_API_KEY=your-server-side-key \
  -e JUDGE0_API_HOST=your-judge0-host \
  dojo
```

The image intentionally contains **no JDK** and refuses to start unless `JUDGE0_API_URL` is configured. This prevents a public deployment from accidentally running submitted code directly inside the web server. The remote Judge0 service must enforce its own execution sandbox and quotas. Do not put provider keys in frontend variables or source code.

The app sends Java 17 submissions to Judge0 (language ID 62), polls for a result, and maps the response to the same output panel. Hosted runs request a 5-second CPU limit, 10-second wall limit, and 256 KB output-file limit. The web API also has a per-process limit of 10 runs per IP per minute; for multi-instance hosting, configure a shared rate limiter at the hosting edge. If the deployment sits behind a trusted reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of proxy hops so rate limiting uses the client IP safely.

To keep using the local runner instead, do not set `JUDGE0_API_URL`; the local Node server compiles with `javac` and executes with `java`, so a JDK is required on that machine. Local Java execution uses the local user's permissions; only run code you trust.
