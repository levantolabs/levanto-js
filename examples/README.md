# Examples

Runnable examples for the `levanto` client. Each script is standalone and reads
`LEVANTO_API_KEY` from the environment.

## Setup

```bash
npm install
npm run build          # examples import the built package by name (self-reference)
export LEVANTO_API_KEY=lv_live_...
```

## Run

```bash
node examples/01_quickstart.mjs
node examples/02_all_kinds.mjs
node examples/03_batch.mjs
node examples/04_grounding.mjs
node examples/05_error_handling.mjs
node examples/06_custom_transport.mjs
```

| Script | Shows |
|---|---|
| `01_quickstart` | Client setup, `decide()` envelope, a shortcut |
| `02_all_kinds` | yesno / choice / scale / sort / tags |
| `03_batch` | One document, many questions, `BatchItem[]` |
| `04_grounding` | Web-search grounding and `grounding_meta` |
| `05_error_handling` | `ready()` and typed errors |
| `06_custom_transport` | Injecting your own `fetch` |

The Sage endpoint is scale-to-zero, so the first call after an idle period may
take ~90s to warm up.
