# SDR OS server

Server-side code for the SDR dashboard, hosted on monday code.

## Endpoints
- `GET /health` returns `{ ok: true }`
- `GET /briefing/status` reports whether the `ANTHROPIC_API_KEY` secret is set (never the value)

## Secrets
Set `ANTHROPIC_API_KEY` in the Developer Center under Host on monday > Server-side code > Secrets.

## Deploy
From this folder, with the monday apps CLI installed and initialised:

    mapps code:push -i <APP_VERSION_ID>

Do not use `--client-side`; that is for the dashboard front end in `../quickstart-react`.
