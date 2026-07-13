# Freelance Budget App — Project Context

## What this is
A single-file, offline-capable personal finance app (`index.html`). No server, no build step, no dependencies fetched at runtime except PDF.js (lazy-loaded only when importing a PDF statement). All data lives in `localStorage`.

## Architecture
- **Single file**: all HTML, CSS, and JS embedded in `index.html` (~2500 lines)
- **State**: one `state` object, mutated directly, persisted via `saveState()` / `loadState()` using `localStorage`
- **Rendering**: `render()` sets `main.innerHTML` via string templates — no virtual DOM, no framework
- **Storage key**: dynamic via `getStorageKey()` — changes per active profile so each profile has isolated data
- **Profiles**: multiple named profiles (e.g. one per person), switchable from the header badge. Default profile uses key `freelance-budget-v2`; others use `freelance-budget-v2-${id}`

## Design system
- Dark theme: `#0D0D12` background
- Font: Unbounded (Google Fonts, loaded in `<head>`)
- Accent palette: `--lime` (#CAF53A), `--pink` (#F472B6), `--teal` (#2DD4BF), `--blue` (#60A5FA), `--orange` (#FB923C)
- CSS variables defined on `:root`

## Key features implemented

### Accounts & card dock
- Accounts have types: `current`, `savings`, `isa`, `invest`, `cash`
- Savings/ISA/invest accounts support interest rate, monthly contribution, target amount
- Current accounts support overdraft toggle (limit + APR)
- Card dock: fixed right-side panel, peeks 64px, slides out on hover
- **Important**: dock hover is JS-driven (`panel.onmouseenter` / `panel.onmouseleave`), NOT CSS `:hover` — CSS hover was unreliable due to pointer-events interactions with transforms
- `renderCardDock()` always strips `dock-open` class at the top so clicking a card closes the dock cleanly
- Cards sorted by account type; show 4-letter abbreviation (`makeAbbr(name)`) and type badge

### Debts
- Types: credit card, loan, mortgage, overdraft, other
- Interest-free period toggle: start date, duration (months), covered amount
- `isInInterestFree(debt)` and `getChargeableBal(debt)` used in interest calculations

### Recurring bills
- Split bill toggle: percentage or fixed amount
- `billUserShare(b)` returns the user's share; used everywhere instead of `b.amount`
- Split shown as a blue `XX% split` badge in the list

### Statement import (Income + Expenses tabs → "↑ Import Statement")
- Accepts `.pdf` and `.csv`
- **PDF**: lazy-loads PDF.js from CDN (requires internet); groups text by Y-coordinate to reconstruct rows; regex detects dates and amounts
- **CSV**: fully client-side, no internet needed; auto-detects header columns (date, description, amount/debit/credit); handles quoted fields, multiple date formats, banks that use separate debit/credit columns
- Both feed into the same review modal (`#pdf-modal`) where rows can be edited before import

### Dashboard insights
- `generateDashboardInsights()` returns cards shown above charts on the dashboard
- Types: `warn` (orange), `danger` (pink), `info` (blue), `pos` (lime)
- Checks: 0% deal ending within 60 days, overdraft >50% used, runway <2 months, budget overruns, bills due this week, savings target ≥85%, strong monthly surplus

### Profiles
- `loadProfiles()` must be called at boot (before `loadState()`) — already done
- `renderProfileUI()` called after every `render()` to keep header badge in sync
- Opening the profile modal uses `openProfileModal()` (not raw `openModal`) so the list populates

### Blank shareable copy
- `downloadBlankCopy()` replaces all storage key strings in `outerHTML` with a unique suffix
- Downloaded file has isolated storage — safe to share, opens blank on any machine

## Known gotchas
- PDF import requires internet; CSV does not
- PDF parsing quality varies by bank — image-based/scanned PDFs won't work
- The animation retrigger in `render()` uses `main.offsetHeight` to force a reflow — this is intentional, not a bug
- `billUserShare(b)` must be used anywhere bill amounts feed into totals (monthly recurring, category chart, etc.) — do not use `b.amount` directly for bills that may be split
