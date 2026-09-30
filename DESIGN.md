---
name: Cinq jours
description: A five-day language learning routine that turns authentic content into structured daily practice.
colors:
  french-teal: "#04637B"
  german-forest: "#145F23"
  english-navy: "#1C4680"
  chinese-vermillion: "#A52C0A"
  french-rose: "#DFA397"
  german-sage: "#C5DAC1"
  english-periwinkle: "#bbbdf6"
  chinese-sand: "#EFD9A8"
  warm-parchment: "#F4EEE0"
  warm-dark: "#262220"
  warm-gray: "#6b665e"
  warm-dark-gray: "#4a453f"
  antique-gold: "#B08D57"
  terra-cotta: "#B5432E"
  muted-forest: "#5C7A5A"
typography:
  display:
    fontFamily: "Georgia, serif"
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.05em"
    textTransform: "uppercase"
  brand:
    fontFamily: "Petit Formal Script, cursive"
    fontSize: "1.5rem"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "36px"
scrollbar:
  width: "6px"
  style: "overlay"
components:
  button-primary:
    backgroundColor: "{colors.english-navy}"
    textColor: "{colors.warm-parchment}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.warm-dark}"
  button-secondary:
    backgroundColor: "{colors.antique-gold}"
    textColor: "{colors.warm-dark}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.warm-gray}"
    rounded: "{rounded.full}"
    padding: "8px 12px"
  chip-action:
    backgroundColor: "{colors.antique-gold}"
    textColor: "{colors.warm-dark}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  input-field:
    backgroundColor: "rgba(255,255,255,0.7)"
    textColor: "{colors.warm-dark}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card-content:
    backgroundColor: "rgba(255,255,255,0.6)"
    textColor: "{colors.warm-dark}"
    rounded: "{rounded.md}"
    padding: "20px"
  modal-panel:
    backgroundColor: "{colors.warm-parchment}"
    textColor: "{colors.warm-dark}"
    rounded: "{rounded.lg}"
    padding: "24px"
  toast-success:
    backgroundColor: "{colors.muted-forest}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "6px 16px"
  toast-error:
    backgroundColor: "{colors.terra-cotta}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "6px 16px"
---

# Design System: Cinq jours

## Overview

**Creative North Star: "The Daily Ritual"**

Cinq jours is a quiet, editorial companion for daily language practice. The interface feels like opening a well-worn notebook at a favourite cafe: warm parchment surfaces, measured typography, and just enough structure to guide a 15-minute session without demanding attention. The design is restrained and content-first — language material is the hero, and the UI recedes around it.

The system is editorial in character: Georgia display faces bring literary weight to section headings, IBM Plex Mono labels carry the precision of marginalia, and the warm neutral palette keeps the eye on the transcript, not the chrome. Each language the user studies shifts the ambient color — French teal, German forest, English navy, Chinese vermillion — like a cultural hue that tints the ritual without overwhelming it.

**Key Characteristics:**
- Warm parchment surfaces on a colored, language-specific background
- Editorial typography pairing: Georgia display + Inter body + IBM Plex Mono labels
- Per-language color theming via CSS custom properties
- Flat by default; shadows appear only as a response to interaction
- Pill-shaped buttons and clip-path tab ribbons as signature forms
- Content-dense but never cluttered; generous spacing within panels

## Colors

A warm neutral core (parchment, dark brown, warm grays) grounds every screen. Each target language contributes a primary hue and a soft accent, applied through CSS custom properties on `html[lang]`.

### Primary (per-language)

- **French Teal** (#04637B): The French learning environment's dominant hue. Applied as the header background, primary button fill, and active tab color. Deep enough to carry white text with confidence.
- **German Forest** (#145F23): The German learning environment's dominant hue. A grounded, natural green that evokes depth and patience.
- **English Navy** (#1C4680): The English learning environment's dominant hue. Authoritative and calm, the deepest of the four primaries.
- **Chinese Vermillion** (#A52C0A): The Chinese learning environment's dominant hue. Warm and assertive, the most saturated of the four.

### Secondary (per-language accents)

- **French Dusty Rose** (#DFA397): Soft counterpart to French Teal. Used for secondary buttons, tags, and accent borders within the French context.
- **German Sage** (#C5DAC1): A pale, natural green that pairs with German Forest. Used for accent fills and soft borders.
- **English Periwinkle** (#bbbdf6): A cool, light blue-violet that softens English Navy. Used for accent fills and interactive highlights.
- **Chinese Warm Sand** (#EFD9A8): A warm, golden neutral that balances Chinese Vermillion. Used for accent fills and soft backgrounds.

### Neutral

- **Warm Parchment** (#F4EEE0): The primary content surface. Every main panel, modal, and tab ribbon rests on this color. It replaces white as the default background, bringing warmth and a paper-like quality. Also used as the primary text color on dark (language-colored) surfaces.
- **Warm Dark** (#262220): The main body text color. A near-black with a warm brown undertone, never a cold pure black.
- **Warm Gray** (#6b665e): Secondary text — descriptions, metadata, helper copy. Always warm-tinted, never a neutral gray.
- **Warm Dark Gray** (#4a453f): Tertiary text and subtle UI elements. Sits between Warm Dark and Warm Gray in the hierarchy.

### Semantic

- **Antique Gold** (#B08D57): The universal accent for interactive highlights — selected states, active labels, vocabulary saves, focus rings, and action chips. Its warmth bridges all four language themes.
- **Terra Cotta** (#B5432E): Error states, recording indicators, and destructive actions. Warm enough to sit comfortably on parchment without feeling alarming.
- **Muted Forest** (#5C7A5A): Success toasts and positive confirmations. Understated and reassuring.

### Named Rules

**The Cultural Hue Rule.** The language-specific primary and accent colors are set once on `html[lang]` and flow through CSS custom properties (`--background`, `--accent`, and their derivatives). No component hardcodes a language color; all language identity comes from the custom property layer.

**The Warm-Only Rule.** Every neutral in the system carries a warm undertone. Pure gray (`gray-500`, `#888`, etc.) never appears in the UI. Secondary and tertiary text is always tinted from the warm palette (#6b665e, #4a453f).

## Typography

**Display Font:** Georgia (with serif fallback)
**Body Font:** Inter (with sans-serif fallback)
**Label/Mono Font:** IBM Plex Mono (with monospace fallback)
**Brand Font:** Petit Formal Script (with cursive fallback)

**Character:** The pairing is editorial and literary. Georgia brings the weight of a printed page to section headings and transcript text. Inter provides clean, highly legible body copy. IBM Plex Mono adds the precision of marginalia — timestamps, labels, metadata. Petit Formal Script appears only in the brand wordmark "Cinq jours," lending a handwritten, personal signature.

### Hierarchy

- **Display** (400, clamp(1.5rem, 4vw, 2.25rem), 1.2): Section headings — "La source," "Ressources," day titles. Georgia serif, never uppercase. Used at `text-3xl` (30px) for major sections and `text-2xl` (24px) for modal titles.
- **Body** (400, 1rem/15px, 1.6): Transcript text, descriptions, paragraph content. Inter, warm-dark on parchment. Max line length unconstrained by design but naturally limited by panel widths (~65-75ch).
- **Label** (500, 0.625rem/10px, 1, 0.05em letter-spacing, uppercase): Metadata, section sub-labels, tab labels, timestamps. IBM Plex Mono, always uppercase, always tracked. Colored in Antique Gold or Warm Gray depending on context.
- **Brand** (400, 1.5rem/24px, normal): The "Cinq jours" wordmark in the header only. Petit Formal Script, colored in `--primary-text` (Warm Parchment on the language-colored header).

### Named Rules

**The Mono-For-Data Rule.** IBM Plex Mono is reserved for timestamps, labels, metadata, and code-like content. It never appears as body copy or display text. Its role is precision and marginalia, not narrative.

## Layout

The app uses a two-zone layout: a language-colored outer shell (header + sidebar tabs) and a warm-parchment inner content panel.

**Outer shell:** Full-width, colored with `var(--background)` (the language-specific primary). The header spans the full width with the logo left and controls right. Below it, sidebar tabs and the main content area sit in a flex row (desktop) or flex column (mobile).

**Inner content panel:** A single `rounded-2xl` (16px) parchment-colored container (`bg-[#F4EEE0]`) with `shadow-2xl`. Content padding (`p-5` on mobile, `p-9` on desktop) lives on the inner div, not the panel. For bounded views (carnet, resources, day 2, journal) the panel itself is the scroll container, so its custom scrollbar sits flush at the panel border. All day views, the source importer, the journal, and the carnet live inside this panel.

**Sidebar tabs:** On desktop, a vertical column of clip-path-shaped tabs (`cj-tab-ribbon`) sits to the left of the main panel. Each tab is 68px tall, full sidebar width, with an angled edge on the right (desktop) or a pentagon shape (mobile). Active tabs expand slightly and gain `shadow-lg`. On mobile, tabs wrap horizontally as smaller square icons.

**Spacing rhythm:** `gap-2` (8px) between sidebar tabs, `gap-3` (12px) between card grids, `space-y-5` or `space-y-6` (20-24px) between sections within a view. Internal component spacing uses `gap-1` through `gap-3`.

**Responsive:** Single-column on mobile with horizontal tab wrapping at the top. Two-column on `md:` (768px+) with vertical sidebar tabs left and the main panel right.

## Journal — The Still Page

The journal tab is a calm, analog "sanctuary" (letterpress direction): one page, one day. It is **decoupled from the source/resource** — `JournalView` receives no `sourceText`/`sourceTitle`/`sourceId`; entries are a global `localStorage` array keyed by date, and topic/audio corrections post without a source context.

**Two-zone composition (desktop, `xl:`+):** a two-page spread — a relative flex row (`xl:items-stretch`) where the left **Today's page** and right **The Thread** are each `xl:w-1/2` and stretch to equal height (`xl:h-[calc(100dvh-2rem)]`). A page-thickness shadow (`0_2px_0_#efe9da, 0_14px_30px_-16px_rgba(38,34,32,0.4)`) gives the pages physical depth; no center spine or inner edge bars. Both pages share the `.cj-paper` surface. Under `xl:` it collapses to a single stacked column with The Thread below.

- **Today's page** is a `.cj-paper` card: a `cj-mono` accent eyebrow "Journal", the date set in the script face (`cj-formal` / Petit Formal Script), a dismissible italic prompt suggestion (accent-soft), a large soft writing surface (17px, `bg-white/50`), a **Correct myself** button in the accent (`bg-[var(--accent)]`) and a **Correct my entry** button in the main colour (`bg-[var(--background)]`), an optional oral-entry recorder, and a single primary **Save entry** pill (`bg-[var(--accent)]`).
- **The Thread** keeps the existing **Cards/Calendar dual toggle** (unchanged mechanics). Cards render as a Google-Keep-style masonry (`columns-2`, `break-inside-avoid`) — each card sizes to its own content — each card sizes to its own content; the entry text is capped by a **row limit** (`line-clamp-[10]`) rather than a height box, so text is never hard-cut. Small date title (`text-[9px]`). The open-entry modal uses `JournalFlipCard` (paper, flip-to-correct).

**Correction as marginalia (reveal, don't replace):** `JournalMarginalia` renders the entry's *original* text continuously; flagged segments get a wavy accent underline (`.cj-ink` / `.cj-ink-flag`) and suggestions a wavy green underline (`.cj-ink-sug`). Hovering/focusing a marked span reveals a margin note (correction + comment + add-to-carnet) that fades in (600–800ms ease-out). No spinners — generating/correcting states use `LoadingDots`.

**Paper token:** `.cj-paper` (`components/CinqJoursApp.tsx` `<style>` block) — warm `#FBF7EE` with a faint SVG-noise texture and a 1px inset hairline. Accent stays a low-volume whisper-thread (underlines, focus ring, the Save pill, quiet ghost buttons). Topic generation is **on-demand only** (no auto daily prompt).

## Elevation & Depth

The system is flat by default. Surfaces are separated by borders and color contrast, not shadows. Shadows appear only as a response to interaction or to lift specific structural elements.

**No-shadow surfaces:** Content cards, transcript panels, and input fields use thin borders (`border-[#26222014]` to `border-[#26222022]`) and semi-transparent white backgrounds (`bg-white/60`, `bg-white/70`) to define their edges against the parchment. No box-shadow at rest.

**Purpose shadows:**
- `shadow-sm`: Video embeds and resource cards at rest — a subtle lift to separate media from the parchment.
- `shadow-lg`: Active sidebar tabs, buttons with emphasis, toast notifications.
- `shadow-2xl`: The main content panel, modals, and floating popups (word definitions, sentence translations). These are the highest-elevation elements in the system.

### Named Rules

**The Flat-By-Default Rule.** Cards, inputs, and transcript panels have no shadow at rest. Depth comes from border + background contrast. Shadows appear only on hover, focus, or for elements that structurally float above the surface (modals, popups, the main panel).

## Shapes

The form language is rounded and pill-shaped. Corners are never sharp; the system moves between four radius steps.

- **sm (4px):** Annotation badges, small inline labels, scrollbar thumbs.
- **md (8px):** Content cards, input fields, transcript panels, video embeds. The workhorse radius.
- **lg (16px):** Modals, the main content panel.
- **full (9999px):** Every button, chip, toast, tab, and the language switcher. The pill shape is the system's signature.

**The tab ribbon** is the one non-rounded form: a clip-path polygon that creates a pentagon shape (mobile) or an angled-right-edge rectangle (desktop). This is the system's most distinctive silhouette.

**Borders** are thin and warm-tinted: `border-[#26222014]` (very subtle) to `border-[#26222044]` (visible). Gold-tinted borders (`border-[#B08D5744]`) mark interactive or save-related elements.

## Scrollbars

Custom thin overlay scrollbars (`.cj-scrollbar`, 6px wide) replace the native bar on every scrollable surface, so macOS overlay scrollbars never leave a dead gutter of empty space.

**The Flush-At-Border Rule.** A scrollbar must sit flush against its container's visible border — never floating mid-panel with padding between the scrollbar and the edge. The main content panel (`<main>`) is itself the scroll container for bounded views (carnet, resources, day 2, journal); its `overflow-y-auto cj-scrollbar` rests at the panel's `rounded-2xl` border. Content padding (`p-5` / `p-9`) lives on the inner div, not on the scroll container, so the scrollbar is never inset. This matches the convention used by self-contained scroll boxes such as the reading/transcript panel.

**Reading panel alignment.** The source reading/transcript panel lays each line out as a flex row: a mono timestamp column (`w-10`, 40px) followed by the text. The column is reserved only when a line carries a timestamp (video transcripts). Text-mode reading (pasted text, no timestamps) renders no column, so the text aligns to the container's left padding. To keep both modes visually balanced, the panel's right padding is `pr-16` (64px) when timestamps are present — matching the 40px column + 4px gap + 20px left padding — and `pr-5` (20px) when absent, so left and right margins are equal.

## Components

### Buttons

Pill-shaped, solid fills with clear hierarchy. Tactile hover transitions.

- **Shape:** Fully rounded (`rounded-full`). Padding `px-5 py-2.5` for standard, `px-4 py-2` for compact.
- **Primary:** `bg-[var(--background)]` (language-colored) with `text-[var(--primary-text)]` (parchment). Hover darkens to `var(--background-hover)`. Used for import, submit, and primary navigation actions.
- **Secondary:** `bg-[var(--accent)]` (language accent) with `text-[#262220]`. Hover darkens to `var(--accent-hover)`. Used for save, accent actions.
- **Ghost/Outline:** `border border-[#26222033]` with transparent background and `text-[#4a453f]`. Hover gains a faint background (`hover:bg-[#26222008]`). Used for redo, cancel, and low-emphasis actions.
- **Hover/Focus:** All buttons use `transition` for smooth color shifts. No transform or scale on hover — the system stays grounded.

### Chips / Action Tags

Small pill-shaped interactive labels for save, edit, and toggle actions.

- **Style:** `rounded-full border border-[#B08D5744] bg-[#B08D5714]` with `text-[#7a5f30]`. Hover deepens the background to `bg-[#B08D5728]`.
- **Accent variant:** `border-[var(--accent-border)] bg-[var(--accent-soft)]` with `text-[var(--accent-text)]`. Used for saved-state indicators.
- **Size:** `px-2.5 py-1 text-xs` or `px-3 py-1.5 text-xs`.

### Cards / Content Containers

Flat at rest, defined by borders and semi-transparent backgrounds.

- **Corner Style:** `rounded-lg` (8px).
- **Background:** `bg-white/60` or `bg-white/70` against the parchment surface.
- **Border:** `border border-[#26222014]` (very subtle) or `border-[#26222022]` (slightly more visible).
- **Shadow:** None at rest. `shadow-sm` on resource cards and video embeds.
- **Internal Padding:** `p-4` to `p-5` (16-20px).

**Exception — Carnet drawer cards:** Saved-item cards inside the `VocabDrawer` overlay use a solid white (`#FFFFFF`) background rather than the translucent parchment. The drawer is a floating panel, and the white cards make saved entries stand out against the parchment drawer surface. This is the one intentional use of pure white in the system.

### Inputs / Fields

Soft, translucent fields that sit lightly on the parchment.

- **Style:** `rounded-lg border border-[#26222022] bg-white/70`. Placeholder text is `text-[#26222055]`.
- **Focus:** Border shifts to `border-[#B08D57]` (Antique Gold) or gains `focus:ring-1 focus:ring-[#B08D57]`. No glow or box-shadow expansion.
- **Error:** Not explicitly styled; errors surface via toast notifications and annotation badges.

### Navigation (Sidebar Tabs)

The system's most distinctive component. Clip-path polygon shapes that form a visual ribbon.

- **Desktop:** Vertical column, each tab 68px tall × full sidebar width. Clip-path creates an angled right edge: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)`. Active tab expands to 140px wide, gains `shadow-lg`, and shifts to parchment background.
- **Mobile:** Horizontal row of square icons (44px × 44px). Clip-path creates a pentagon: `polygon(0 0, 50% 8px, 100% 0, 100% 100%, 0 100%)`.
- **Typography:** IBM Plex Mono, 10px, uppercase, tracked. Hidden on mobile, visible on desktop.
- **States:** Default is translucent parchment on language-color (`bg-[#F4EEE01c] text-[#F4EEE0aa]`). Hover brightens to `bg-[#F4EEE033]`. Active is solid parchment with dark text and a gold icon.

### Language Switcher

A compact pill segmented control in the header.

- **Style:** `rounded-full border border-[#F4EEE022]` with internal pill buttons. Active segment: `bg-[#F4EEE0] text-[#171B22]`. Inactive: `text-[#F4EEE0aa]` with hover brightening.
- **Size:** `px-2 py-0.5 text-xs` per segment.

### Toast Notifications

Bottom-center floating pills for success and error feedback.

- **Success:** `rounded-full bg-[#5C7A5A] text-white px-4 py-1.5 text-xs font-medium shadow-lg`.
- **Error:** `rounded-full bg-[#B5432E] text-white px-4 py-1.5 text-xs font-medium shadow-lg`.
- **Animation:** `cj-fade-in` (opacity 0 → 1, translateY 4px → 0, 0.35s ease-out).

### Modals

Centered overlays with a dark scrim and warm parchment content.

- **Scrim:** `bg-[#262220]/70` (70% opacity warm dark).
- **Panel:** `rounded-2xl bg-[#F4EEE0] p-6 shadow-2xl max-w-md`.
- **Close:** Top-right `rounded-full` icon button with `hover:bg-[#26222011]`.

## Do's and Don'ts

### Do:
- **Do** use the warm parchment (#F4EEE0) as the content surface. Never use pure white (#fff) for content panels.
- **Do** apply language-specific colors through CSS custom properties (`var(--background)`, `var(--accent)`). Never hardcode a language hue inside a component.
- **Do** use `rounded-full` (pill) for every button, chip, toast, and tab. The pill shape is the system's signature form.
- **Do** keep borders thin and warm-tinted (#262220 at low opacity). Never use pure gray borders.
- **Do** use IBM Plex Mono exclusively for labels, timestamps, and metadata. Always uppercase with letter-spacing.
- **Do** let content breathe. Use `space-y-5` or `space-y-6` between sections. Never compress sections below 16px vertical rhythm.

### Don't:
- **Don't** use pure gray (`gray-500`, `#888`, etc.) for any text or border. Every neutral must carry a warm undertone.
- **Don't** add shadows to cards or inputs at rest. Shadows are reserved for hover, focus, modals, and the main content panel.
- **Don't** use sharp corners (0 radius). The minimum radius is `rounded` (4px) for tiny badges; everything else is `rounded-lg` or `rounded-full`.
- **Don't** place colored text on colored backgrounds without checking contrast. The parchment surface is the safe canvas; language-colored surfaces should only carry `--primary-text` (parchment) or white.
- **Don't** use gradient fills, glass effects, or blur as decoration. The system is flat and material-honest.
- **Don't** mix font roles. Georgia is display only, Inter is body only, IBM Plex Mono is label/metadata only, Petit Formal Script is brand wordmark only.
