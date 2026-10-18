# MEP PROJECTS — Design System

The application's visual language lives in `new-app/frontend/src/styles/`, loaded
in one place (`src/index.css`) and in this order:

| File | Holds |
|---|---|
| `tokens.css` | Every colour, type size, space, radius, shadow and motion value |
| `base.css` | Document defaults, native element styling, focus and touch behaviour |
| `layout.css` | The shell: rail, header, content column, responsive drawer |
| `components.css` | Panels, tables, buttons, forms, badges, KPIs, modals, states |
| `print.css` | Paper rules for the documents the business sends out |

**Scope rule:** stylesheets carry presentation only. No business rule, workflow,
permission or terminology lives in CSS. A screen reaches for an existing class
rather than an inline style; where inline styles remain they are presentational
leftovers, not logic.

## Tokens

Colour is a 9-step brand ramp built around the app's established blue
(`--brand-600: #1a5fb4`), a cool neutral ramp tuned for dense data screens, and
four semantic families (`ok`, `warn`, `bad`, `info`) each with a 50/100/600/700
step so a tint, a border and readable text always come from the same family.

The three business divisions have fixed accents, so division is visible at a
glance without extra words:

| Division | Token pair |
|---|---|
| HVAC | `--div-hvac-bg` / `--div-hvac-fg` |
| Solar | `--div-solar-bg` / `--div-solar-fg` |
| MEP | `--div-mep-bg` / `--div-mep-fg` |
| AMC (segment) | `--div-amc-bg` / `--div-amc-fg` |

Applied roles (`--canvas`, `--surface`, `--rail`, `--border`, `--focus-ring`, …)
sit on top of the ramps, so a theme change happens in one place.

## Components

The vocabulary the screens use:

- **Shell** — `.shell`, `.shell-header`, `.shell-nav`, `.nav-item`, `.nav-toggle`,
  `.shell-scrim`. Below 1024px the rail becomes a drawer; below 640px the header
  compacts. The drawer closes on navigation and on scrim tap.
- **Page** — `.page`, `.page-head`, `.page-actions`, `.panel`, `.panel-head`,
  `.panel-head-meta`, `.section-title`.
- **Data** — `.table-wrap` (horizontal scroll with a hairline so a scrolled table
  still reads as one object), `.data-table`, `.group-row` (a spanning group
  header, used by delivery challans), `.row-ok` / `.row-warn` / `.row-bad` row
  tints, `.due` for an overdue figure, `.cell-sub` for a secondary line in a cell.
- **Numbers** — `.kpi-bar`, `.kpi-card` with `.kpi-ok` / `.kpi-warn` / `.kpi-bad`
  / `.kpi-idle`, `.kpi-value`, `.kpi-label`, `.kpi-note`.
- **Status** — `.status-badge` with `.status-open`, `.status-won`, `.status-lost`,
  `.status-pending`, `.status-received`; `.div-chip` with the division classes.
- **Input** — `.field`, `.form-grid`, `.filter-panel`, `.filter-grid`,
  `.filter-field`, `.filter-pair`, `.search-bar`, `.search-count`.
- **Action** — `.btn` with `.pri`, `.sec`, `.ghost`, `.danger`, `.grn`, `.sm`,
  `.lg`, `.block`; `.btn-row` (inside a data table it never wraps, so a cell full
  of buttons cannot stretch a row).
- **Feedback** — `.alert` (`.alert-error|success|warn|info`), `.empty-state`,
  `.spinner`, `.skeleton`, `.field-error`, `.field-hint`.
- **Overlay** — `.modal-overlay`, `.modal`, `.modal-wide`, `.modal-xl`,
  `.modal-actions`.

## Accessibility and input

- Focus is never removed: `:focus-visible` draws a 2px `--focus-ring` outline,
  and inputs carry an equivalent ring as a box-shadow.
- Coarse pointers get larger hit areas (`@media (pointer: coarse)`), so the same
  screens work on a phone on site.
- Motion respects `prefers-reduced-motion`.
- Status is never carried by colour alone — every badge and tint is accompanied
  by a word or a figure (`3 overdue ⚠`, `Not set`, `Raised 2026-09-25`).

## Printed documents

`print.css` plus per-document markup covers the things the company sends out:
the quotation, the AMC document and the delivery challan. All three share the
same letterhead treatment and the brand blue heading rule, so a customer
receives one consistent family of documents. The delivery challan is printed per
challan number from the project screen (`DeliveryChallanPanel.jsx`).

## Conventions for new screens

1. Start from `.page` + `.panel`; never introduce a new page wrapper.
2. Put figures in a `.kpi-bar`, filters in a `.filter-panel`, records in a
   `.table-wrap > .data-table`.
3. Use a semantic family for meaning (`bad` for money at risk or overdue work,
   `warn` for attention, `ok` for settled), not a raw hex value.
4. Give every list an `.empty-state` that says what would put something there.
5. Keep row actions in a `.btn-row`; keep the destructive one last.
