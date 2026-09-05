# Relay — Live GPS Tracking for Fleets & Service Providers

Relay connects three types of users for a truck/trailer service business:

- **Mechanics** — go "live" from their phone to share real GPS location while working a job
- **Shop owners** — see every mechanic's live position on one map, create jobs, and assign them
- **Fleet managers** — log in and see only their own company's jobs: technician location, distance, and arrival status

## Tech stack

- Plain HTML/CSS/JavaScript (no build step required)
- [Leaflet](https://leafletjs.com/) + OpenStreetMap for live maps (free, no API key)
- Browser Geolocation API for real GPS tracking
- [Supabase](https://supabase.com) for the backend database
- Deployed on [Netlify](https://netlify.com)

## Project structure

```
index.html    — page structure
style.css     — all styling
script.js     — app logic (auth, GPS tracking, maps, database calls)
schema.sql    — Supabase database schema (run once when setting up a new project)
```

## Setup

1. Create a free [Supabase](https://supabase.com) project.
2. Run `schema.sql` in the Supabase SQL Editor to create the `accounts`, `jobs`, and `locations` tables.
3. In `script.js`, set `SUPABASE_URL` and `SUPABASE_KEY` to your project's values (Settings → API).
4. Deploy the folder to Netlify (or any static host).

## Database schema

**accounts** — name, role (`mechanic`/`shop`/`fleet`), company (fleet managers only), passcode

**jobs** — customer, vehicle, assigned mechanic, breakdown location (lat/lng), status (`assigned` → `en_route` → `on_site` → `complete`)

**locations** — one row per mechanic, continuously overwritten with their latest lat/lng and status

## Known limitations (prototype stage)

- Passcodes are stored in plain text — not production-grade auth
- Row Level Security policies are currently open — anyone with the API key can read/write all data
- Background GPS tracking pauses when a mobile browser tab is backgrounded or the phone is locked
- Uses a free/demo geocoding-free flow (map-click only for setting breakdown locations)
