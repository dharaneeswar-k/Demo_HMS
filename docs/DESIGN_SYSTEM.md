# Nallam HMS — Design System (v2)

One look for every module, taken from the Lab Worklist. All of it lives in `assets/css/theme.css`, which loads last in `index.html`, so every screen (old and new) follows it without extra classes.

## Principles

1. **Flat and quiet.** White surfaces, 1 px lines, grey header bars. No gradients, glows, hover lifts or coloured icon blobs.
2. **Colour only for meaning.** Teal is the single accent (buttons, active tab, links). Red / amber / green / blue appear only for status (STAT, overdue, paid, info). Never colour whole rows or decorate with colour.
3. **Dense but readable.** 13 px body, 32 px controls, compact table rows, numbers in tabular figures.
4. **Same parts everywhere.** Use the shared classes below — no module-specific copies of buttons, tables or cards.

## Tokens (`:root` in theme.css)

| Token | Value | Use |
|---|---|---|
| `--h-navy` | #0F2C44 | Titles, sidebar, modal top line |
| `--h-brand` | #0A7C86 | Primary buttons, active tab, links (Settings → Theme can override it) |
| `--h-ink` / `-2` / `-3` | #1B2733 / #4A5866 / #7B8896 | Text, secondary text, hints |
| `--h-line` / `--h-line-2` | #D8DEE5 / #E7EBEF | Borders / row dividers |
| `--h-head` | #EEF2F6 | Table headers, card header bars, neutral chips |
| `--h-bg` | #F3F5F8 | Page background |
| `--h-red` `--h-amber` `--h-green` `--h-blue` (+ `-50` tints) | | Status only |

Corners: 4 px (controls, cards), 6 px (modals). Font: Inter 13 px.

Older names (`--navy`, `--teal`, `--border`, `--radius`, `--shadow`…) are mapped onto these, so older stylesheets follow automatically.

## Building blocks

| Need | Use |
|---|---|
| Page title | `.page-head` (h1 18 px + `.muted` line) — or the `.h-head` row used by the worklist |
| Panel | `.card` › `.card-head` (grey bar, 13 px navy title) › `.card-body` |
| List / grid | `.table` (or `.h-table`), first column S.No where the list is a queue; status as a `.badge` |
| Filters | `.toolbar` with `.input-sm`, `.chip` (square, navy when active) |
| Steps / sections | `.tabs` › `.tab` with `.tab-count` (teal when active) — or `.h-tabs` |
| Numbers at a glance | `.kpi` / `.stat` — plain number, grey icon tile |
| Status | `.badge-success / -warning / -danger / -info / -neutral` |
| Messages | `.alert-*` (inline), `toast()` (after an action) |
| Forms | `.field` › `label` + `.input` (32 px), `.form-grid` |
| Dialogs | `modal()` — navy top line, grey footer bar |
| Buttons | `.btn-primary` (one per screen area), `.btn-secondary`, `.btn-ghost`, `.btn-danger` |

## Do / don't

- Do keep one primary button per area; secondary actions are `.btn-secondary` or links.
- Do show where a patient is in plain text (Token 7, Bed S-4) — not with colours.
- Don't tint table rows (`row-danger` / `row-warning` no longer colour the row; the status badge says it).
- Don't add new gradients, shadows or rounded pills; don't hard-code colours in a module — use the tokens.
- Charts use the same palette (`PALETTE` in `components.js`).
