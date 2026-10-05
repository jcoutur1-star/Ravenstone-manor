# The Murder of Ravenstone Manor — Netlify build

This folder contains a Netlify Functions backend and a Supabase database/realtime setup for the multiplayer game. Netlify serves the web page and API; Supabase stores room state and sends low-latency room-change notifications. The server returns each player only their own role and clues. The client receives no Supabase secret key.

## What you need

- A Netlify account
- A Supabase account and one project
- Node.js installed on the computer used to deploy

No itch.io account is needed. itch.io can host the browser files, but it does not replace the shared room backend. Netlify Functions plus Supabase are the recommended setup for this project.

## Set up Supabase

1. Create a Supabase project.
2. Open the project’s SQL Editor and run the contents of `supabase/schema.sql`.
3. In the project API settings, copy the project URL, the publishable client key, and the secret key. Supabase may also show older `anon` and `service_role` key names; this project accepts those names as fallbacks.

The table has row-level security enabled and grants direct table access only to the server role. Realtime carries empty “room changed” notifications; clients must still request their own authorized state from the Netlify API.

## Deploy to Netlify

Netlify needs the project source so it can deploy both the static page and Functions. Drag-and-drop static hosting alone will not deploy the API functions.

1. Put this folder in a Git repository and import that repository in Netlify, or use the Netlify CLI from this folder.
2. Add these environment variables in the Netlify site’s environment settings:

   - `SUPABASE_URL` — the Supabase project URL
   - `SUPABASE_PUBLISHABLE_KEY` — the public client key
   - `SUPABASE_SECRET_KEY` — the private server key; keep this secret and never put it in browser code

3. Deploy the site. `netlify.toml` sets the static publish folder and Functions folder. No build command is required.
4. Open the deployed URL on two devices. Use the bot practice buttons for solo play, or create a room and join it from another device.

For command-line deployment, run `npm install`, authenticate with `npx netlify login`, link this folder to the Netlify site, then run `npx netlify deploy --prod`. Enter the Supabase settings in the Netlify dashboard before testing the deployed app.

## Test scenarios

- **Solo practice:** choose “I am the murderer” or “I am innocent; a bot is the murderer.” Three bots join automatically. They each share a clue and cast practice votes.
- **Private party:** host a room and share its randomly generated five-character code. Rooms accept 3–9 human players.
- **Public lobby:** create a public room; it appears in the open-room list until the host starts the game.
- **Multiplayer sync:** Supabase Realtime signals room changes; the page also refreshes room state periodically as a fallback.

The game is an early playable build. Review the clue bank and game balance before inviting a larger group.
