# Verification — run all three before claiming anything is fixed

Each catches a different class of failure. Passing one proves nothing about the
others. This exists because a missing import shipped a blank page while the
production build reported success.

```bash
npm run build          # 1. compiles
node audit.mjs         # 2. capabilities are wired, imports exist
node flow.harness.mjs  # 3. user journeys work    (needs the bundle step below)
```

The flow harness needs a bundle first:

```bash
npx esbuild harness_entry.js --bundle --format=esm --outfile=harness_out/all.mjs \
  --loader:.css=empty --loader:.woff=empty --loader:.woff2=empty \
  --external:react --external:react-dom --external:react/jsx-runtime --external:react-dom/client \
  --define:process.env.NODE_ENV='"test"'
```

## What each one can and cannot see

| Check | Catches | Blind to |
|---|---|---|
| `npm run build` | Syntax, unresolved module paths | **A component used but never imported** — compiles fine, throws on render. Anything runtime. |
| `audit.mjs` | Features written but never called; import integrity; structural claims | Whether it works at runtime |
| `flow.harness.mjs` | Crashes on real journeys: open from nexus, switch tabs, open settings | Anything needing a live API call |

## Bugs each has actually caught

- **build**: syntax errors from scripted edits
- **audit**: Tesseract OCR, report provenance, `retryAfterSeconds` — all written, unit-tested, wired to nothing; the missing `ToolErrorBoundary` import
- **flow**: `ToolErrorBoundary is not defined` on opening Site Context — invisible to both the build and the isolation harness

## Standing rule

A unit test proves a function works. It does not prove anything calls it, and it
does not prove the user can reach it. Before marking a fix done, confirm:

1. the code exists,
2. something calls it,
3. a user journey reaches it,
4. the result is visible to the user.
