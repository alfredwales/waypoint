# Freelance Budget App ("Waypoint") — Project Context

## What this is
A personal finance app, built as a single HTML file (`index.html`, ~6,900 lines) and shipped two ways:
1. Directly as a static file — offline-capable, no server, no build step, no runtime dependencies except PDF.js (lazy-loaded only when importing a PDF statement)
2. As a packaged **Electron desktop app** ("Waypoint") for macOS (and Windows via NSIS), via `main.js` / `preload.js` / `package.json`

All user data lives in `localStorage` — the Electron shell is a thin, security-hardened wrapper around the same `index.html`; it has no server component and no additional data store.

## Architecture
- **Single file**: all HTML, CSS, and JS embedded in `index.html`
- **State**: one `state` object, mutated directly, persisted via `saveState()` / `loadState()` using `localStorage`
- **Rendering**: `render()` sets `main.innerHTML` via string templates — no virtual DOM, no framework
- **Storage key**: dynamic via `getStorageKey()` — changes per active profile so each profile has isolated data
- **Profiles**: multiple named profiles (e.g. one per person), switchable from the header badge. Default profile uses key `freelance-budget-v2`; others use `freelance-budget-v2-${id}`

## Electron desktop app
- `main.js`: creates the window (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`), blocks navigation away from the local file, opens external links in the system browser, blocks DevTools in production
- `preload.js`: minimal `contextBridge` surface — `platform`, `getVersion()` (real app version via IPC, not `npm_package_version`, which is blank in the packaged app), `copyToClipboard`, `openExternal`, `onUpdateStatus` (drives the in-app download progress UI)
- **Code signing**: shipped ad hoc (no paid Apple Developer ID). `build/afterSign.js` re-signs the assembled app after packaging — without this, the bundle keeps a stale signature from the base Electron template that doesn't cover the copied-in files, and macOS reports the app as "damaged" (a broken-signature error, not a real corruption)
- **Auto-update**: does *not* use Squirrel.Mac's native install (`autoUpdater.quitAndInstall()`) — that requires a real Developer ID to pass code-requirement validation, which we don't have, so it always fails. Instead: `electron-updater` is used only to *check* for updates; `main.js` then downloads the DMG itself (to the visible Downloads folder, with SHA-512 verification against the release manifest) and opens it, showing the existing custom drag-to-Applications installer window. Progress is forwarded to the renderer over IPC (`update-status` events: `start`/`progress`/`complete`/`error`) for the in-app progress bar
- **Release artifact naming**: `dmg.artifactName` is fixed (`${productName}-${arch}.${ext}`, no version) so `https://github.com/<owner>/<repo>/releases/latest/download/Waypoint-arm64.dmg` always resolves to the current release — used for the in-app "Copy download link" and the manual-download fallback. Don't reintroduce a versioned filename without updating both of those
- Release flow: bump `package.json` version → commit → `git push` → `npm run publish:mac` (builds + uploads DMG, blockmap, `latest-mac.yml` to GitHub Releases). **Also bump `APP_VERSION` in index.html to match** — it's a separate hardcoded constant (not read from `package.json`) so the "what's new" gating works identically in the standalone static-file distribution, which has no Electron IPC to ask for a version

## Design system
- Dark theme: `#0D0D12` background
- Font: Unbounded (Google Fonts, loaded in `<head>`)
- Accent palette: `--lime` (#CAF53A), `--pink` (#F472B6), `--teal` (#2DD4BF), `--blue` (#60A5FA), `--orange` (#FB923C)
- CSS variables defined on `:root`, including `color-scheme: dark` — needed so native controls (select dropdowns, date pickers) render dark; page CSS alone can't restyle an open `<select>` popup

## Key features implemented

### Accounts & card dock
- Accounts have types: `current`, `business`, `savings`, `isa`, `invest`, `cash`
- Savings/ISA/invest accounts support interest rate, monthly contribution, target amount
- Current and business accounts support overdraft toggle (limit + APR)
- `business` accounts get their own section on the Savings tab and feed the Tax estimate shown on a business account's detail page — see below
- Card dock: fixed right-side panel, peeks 64px, slides out on hover
- **Important**: dock hover is JS-driven (`panel.onmouseenter` / `panel.onmouseleave`), NOT CSS `:hover` — CSS hover was unreliable due to pointer-events interactions with transforms
- `renderCardDock()` always strips `dock-open` class at the top so clicking a card closes the dock cleanly
- Cards sorted by account type; show 4-letter abbreviation (`makeAbbr(name)`) and type badge

### Debts
- Types: credit card, loan, mortgage, overdraft, other
- **Multiple concurrent 0% promotions** per debt (`debt.promotions[]`: label, start date, duration in months, covered amount — blank amount means the whole balance is covered by that promo), plus an optional **recurring per-cycle allowance** (`debt.recurringInterestFree`) that's always active rather than date-bound. Old single-promo debts (`hasInterestFree`/`ifStart`/`ifMonths`/`ifAmount`) migrate automatically in `loadState()`
- `isInInterestFree(debt)` / `getChargeableBal(debt)` aggregate across all active promotions + the recurring allowance via `_activePromoCoverage(debt)`
- Promo end dates within 60 days get a distinct "ending soon" warning treatment (list badge, Debt Detail, and the dashboard insight) vs. the calmer "active" styling
- **Debt Detail page** (click a debt row, mirrors Account Detail): balance/APR hero, promo status, spending-by-category donut, 6-month interest-paid line chart, transaction ledger, and an **extra-payment payoff simulator**
- Debts can have statements imported against them (`startDebtStatementImport(debtId)`), tagging expenses with `debtId`. Import rows can be typed Expense / Interest / Payment — payments are marked `isTransfer` (excluded from spend totals, still shown in the debt's ledger)
- **Gotcha**: `calcPayoffMonths`/`calcTotalInterest` simulate at the *current* full APR against the *current* balance — they don't model a promo expiring partway through the simulation. If minimum payment doesn't cover full-rate interest, the balance grows without bound and `calcTotalInterest` can return an astronomically large, meaningless number after hitting the 600-month cap. The payoff simulator guards against this (never quotes "interest saved" against a baseline that never breaks even); the debt list only shows Total Interest when payoff is achievable (`mo<600`) for the same reason. Any new code calling these functions should apply the same guard

### Recurring bills
- Split bill toggle: percentage or fixed amount
- `billUserShare(b)` returns the user's share; used everywhere instead of `b.amount`
- Split shown as a blue `XX% split` badge in the list

### Statement import
Three entry points, all built on the same underlying pipeline:
- **Single-file import** (Income/Expenses tabs, or an Account/Debt Detail page → "Upload Statement"): accepts `.pdf` and `.csv`, both parsed via the shared `_extractStatementRows(file)` helper (PDF lazy-loads PDF.js from a CDN with an SRI hash, requires internet; CSV is fully client-side). Feeds the review modal (`#pdf-modal`), where rows can be edited before import. When importing to a debt, the modal switches into "debt mode": the account column is replaced with a debt banner, and the type dropdown gains Interest/Payment options
- **Bulk import** (Data modal → "Bulk Import All Statements", only shown once `_calcDataMonths() >= 4`): pick many files at once, assign each to an account/debt (filename-guessed, confirm/correct in `#bulk-assign-modal`), then `processBulkImport()` runs the same bill-matching/transfer-detection/history-matching pipeline per file. Only **history-matched** rows (plus structural matches: bill match, transfer, debt payment, recognised interest-charge wording) count as "confident" and import silently; keyword-guessed or unmatched rows are grouped by account/debt and shown in `#bulk-review-modal` for confirmation — styled like dashboard cards, one section per account/debt
- **Vendor category bulk-apply**: in the single-file review modal, setting a category on one row offers to apply it to every other row from the same vendor in that batch (`_checkVendorCategoryMatch`/`_applyVendorCategoryMatch`) — that banner also has an "Always do this" button (`_createRuleFromVendorMatch()`) that persists the vendor→category mapping as a Category Rule on the spot, not just for the current batch
- **Category Rules** (`state.categoryRules`, `{id, vendor, category}`): explicit, user-editable vendor→category mappings, managed as a list on the Expenses tab (`renderCategoryRules` inline in `renderExpenses()`, CRUD via `openAddCategoryRule`/`openEditCategoryRule`/`submitCategoryRule`/`deleteCategoryRule` — same pattern as `state.budgets`). `_applyCategoryRules(rows)` runs first in the categorisation pipeline (before learned history), substring-matching a rule's `vendor` against the same `_normDesc()`-normalised text auto-categorisation uses, and sets the same `_autoMatched` flag exact history matches use — so an explicit rule always wins over both learned history and the keyword fallback
- **Auto-categorisation**: `buildTxHistory()`/`_applyTxHistory()` learn vendor→category from past categorised expenses/income (exact or fuzzy word-overlap match) — only runs on rows a Category Rule hasn't already claimed; `_suggestCategory()` falls back to a static keyword-rule list last
- A one-time **"How Smart Import Works" modal** explains all of the above the first time a user completes any import (tracked via `state.seenSpotlights.importExplainer`)

### Dashboard insights
- `generateDashboardInsights()` returns cards shown above charts on the dashboard
- Types: `warn` (orange), `danger` (pink), `info` (blue), `pos` (lime)
- Checks: 0% promo ending within 60 days (per-promotion, not per-debt), overdraft >50% used, runway <2 months, budget overruns, bills due this week, savings target ≥85%, strong monthly surplus

### Net worth over time
- `getNetWorthHistory()` reconstructs total net worth for the last 6 months by walking backward from the live `getTotalWealth()`, subtracting each month's net delta (dated account income/expenses, joint-share-weighted; dated debt payments minus interest/charges) — same backward-reconstruction technique `getMonthBalanceLine()` already uses for a single account's current month, just extended app-wide and across 6 months
- Savings pots have no dated contribution history (just a live `balance`), so they can't be reconstructed — their current value is baked into the anchor point and implicitly held flat across every historical point, since the backward walk never adjusts for pot changes. A caption under the chart says so whenever pots exist. Don't try to "fix" this by guessing at pot history — there's no data to guess from
- Rendered on the Dashboard via the existing `lineChartSVG()` — no new charting code needed, it already accepts `{label, value}` arrays

### Emergency fund suggestions
- `openEFSuggestionModal()` recommends a 1/2/6-month target tier based on financial health score, and now also a **suggested monthly contribution** (from current surplus) with an estimated time-to-target per tier
- "I already have an emergency fund" check-in: user enters their actual current balance and monthly contribution; `checkEFPlan()` reports on-track vs. suggests either a higher contribution (if surplus allows) or a more realistic near-term goal (if it doesn't)

### Tax (rough self-assessment estimate)
- No dedicated tab — `renderTaxSection(account)` renders inline on a **business account's own detail page** (`renderAccountDetail()`, gated on `account.type==='business' && !activePocketId`), since the estimate only makes sense in the context of that account's income
- `_businessIncomeForTaxYear()` sums income posted to **all** `business`-type accounts within the current UK tax year (`_currentTaxYearRange()`: 6 Apr – 5 Apr) — the figure shown is the whole-business total, not per-account, since that's what's actually taxed; it renders identically regardless of which business account you're viewing
- `_calcIncomeTax()` / `_calcClass4NI()` apply banded Income Tax (with Personal Allowance taper above £100k) and Class 4 NI against that figure, using `state.taxSettings` — all thresholds/rates are user-editable in the collapsible "Tax Rate Settings" panel (`updateTaxSetting()` / `resetTaxSettings()`), since UK bands change most tax years and hardcoding them silently would go stale
- Deliberately simple by design, not a bookkeeping tool: gross business income only (no expense deduction), assumes it's the user's only income, no Scottish rates/marriage allowance/pension modelling. The UI carries a permanent disclaimer — treat this as a rough estimate, never as tax advice, and don't remove that framing when touching this section
- "Set aside in a pot" (`setTaxSetAsideGoal(monthlyAmount, accountId)`) reuses the savings-pot creation flow (same pattern as the Emergency Fund suggestion), pre-filling a "Tax Set-Aside" pot with the suggested monthly amount and linking it to `accountId` via the pot's `linkedAccountId`. Re-invoking it looks for an existing pot linked to that account first (falling back to a name match `"tax"` for pots created before linking existed) and updates it in place rather than creating a duplicate
- Savings pots can optionally carry `linkedAccountId`, pointing at a `business` account (set via the "Linked Business Account" field in the Add/Edit Savings Pot modal, populated by `_populateLinkedAccountSelect()`); `savPotRow()` shows a "🔗 Linked to X" badge when set. `_unassignAccount()` clears the link when the linked account is deleted, so pots never carry a dangling reference

### Growth tab suggestions
- `classifyCat(cat)` (module scope, shared by `buildPriorityActions()` and `buildBudgetRecommendations()`) classifies a category as `essential`/`non-essential`/`financial`/`semi` via keyword lists (`ESSENTIAL_KW`, `NON_ESSENTIAL_KW`, `FINANCIAL_KW`) — don't reintroduce a second local copy of these lists (there used to be two nearly-identical copies before they were hoisted)
- `buildBudgetRecommendations()` excludes essential/financial categories entirely (so housing/utilities/groceries never show up as a "suggested budget") and ranks subscription-like categories (`isSubscriptionCat()`, a `NON_ESSENTIAL_KW` subset — netflix, spotify, streaming, etc.) first, tagged "Recurring" in the UI. It also takes an `excludeCats` set so it doesn't duplicate categories already flagged by `buildPriorityActions()`'s own non-essential CTA
- `calcHealthScore()`'s Budget Control component gives neutral half-credit (13/25) when no budgets are set yet, rather than 0 — having no budgets isn't a failure, and a hard 0 there used to cap the whole score at 75/100 regardless of everything else

### Bug report widget
- Always-visible floating icon (bottom-right, `#bug-report-btn`), positioned clear of the card dock's peek strip the same way `.version-footnote` already is; repositioned above the bottom nav bar on mobile
- Proactively nudges (`maybeShowBugNudge()`) on two signals: 3+ clicks on the same element (by tag+class+text fingerprint, since `render()` replaces `main.innerHTML` wholesale so raw DOM node identity doesn't survive between clicks) within ~1.2s, or any uncaught error/unhandled rejection. Has a 3-minute cooldown between nudges so it isn't naggy
- Sends via EmailJS (`EMAILJS_SERVICE_ID`/`EMAILJS_TEMPLATE_ID`/`EMAILJS_PUBLIC_KEY` — **empty until you complete the EmailJS account setup**, see the comment above them in index.html), since this app has no backend to relay through. Falls back to a pre-filled `mailto:` link if those aren't set or the send fails — never silently drops a report
- The `mailto:` fallback goes through `window.waypointApp.openExternal()` when running in Electron, **not** `window.open()` — the renderer's `window.open` is locked to http(s) only (see `main.js`'s `setWindowOpenHandler`), so a raw `mailto:` link there is silently swallowed. Plain `window.open()` is only used as the fallback-of-the-fallback for the standalone static-file distribution, which has no IPC bridge
- Payload is deliberately limited to the message text + non-sensitive diagnostics (app version, platform, current tab, timestamp, error context if triggered by one) — never financial data or localStorage contents

### What's new modal
- `WHATS_NEW` (keyed by version, same shape as `_SPOTLIGHTS`) + `state.lastSeenVersion` gate a one-time "what's new" popup (`showWhatsNew()`) shown to existing users on the first boot after an update, via the boot sequence comparing `state.lastSeenVersion` to `APP_VERSION`
- New users never see it: `_hideOnboarding()` sets `lastSeenVersion` to the current `APP_VERSION` silently the moment onboarding completes, so their first version becomes their baseline rather than something to announce

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
- Electron window drag region: mark only real interactive elements (`button`, `select`, `input`, and any div-as-button like `.profile-badge`) as `-webkit-app-region: no-drag`. Marking a whole container (e.g. `header *`) makes everything inside it non-draggable, including the empty space that's supposed to move the window
- `calcPayoffMonths`/`calcTotalInterest` simulate month-by-month via `_activePromoCoverage(debt, asOf)`/`_chargeableFromCoverage()`, so they correctly stop charging interest while a 0% promo is active and resume once it expires relative to the simulated month — don't reintroduce a flat `bal*rate` loop that ignores promo end dates
- The Tax section's rates are estimates the user can edit — never hardcode a "this is correct" assumption when touching `_defaultTaxSettings()`; the whole point is that these drift out of date and need to stay overridable
- `spendingForecastSVG`'s lines use `_monotonePathD()` (a monotone cubic/Fritsch-Carlson spline), not a plain Catmull-Rom spline — spending/bills data is cumulative and non-decreasing, and a naive smoothing spline can overshoot and dip the curve below a flat run right before a step, which would visually (and wrongly) suggest spending went down
