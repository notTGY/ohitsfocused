# Project guidelines

## Stack
- Astro 5 with React 19 and strict TypeScript; React pages use `.jsx` or `.tsx` files.
- Tailwind CSS 4 via Vite, shadcn/Radix tooling, and `lucide-react` icons.
- Bun for dependencies and scripts: `bun install`, `bun dev`, `bun run build`, `bun preview`.
- Routes live in `src/pages/`, React components in `src/components/`, shared styles in `src/styles/global.css`, and static assets in `public/`. `@/` resolves to `src/`.

## Single-file pages
- Keep each page's React UI and behavior in one JSX/TSX file, with page-specific state, helpers, types, and small components colocated.
- The current Astro routes use `.astro` shells and hydrate interactive React components with `client:load`. Keep route shells thin and follow this structure.
- Do not split a page into separate hooks, utilities, component folders, or layers just to organize it. Extract shared code only when real reuse makes the overall source smaller and clearer.

## Compact source is a priority
- The owner cares deeply about keeping source code compact and small. Treat this as a core design constraint for every change.
- Use the smallest clear implementation that fully handles the task. Minimize total code, file count, boilerplate, and unnecessary indirection.
- Prefer direct logic, existing dependencies, and browser APIs. Avoid speculative abstractions, configuration, features, and dependencies.
- Keep formatting concise and readable; avoid excessive vertical whitespace, repetitive markup, and comments that restate the code. Never sacrifice clarity or correctness for clever one-liners.
- Reuse existing Tailwind tokens and the `cn` helper in `src/lib/utils.ts`. Keep page-specific styling near its JSX.
- Remove code made obsolete by your change and keep edits focused.

## Product and interaction philosophy
- Oh it's focused is a small hub of everyday creator tools that process content entirely in the browser. No accounts, upload services, or configuration dashboards. Model/font downloads are allowed; user media stays on the device.
- Design the flow, not just the styling: **choose content → work on content → save the result**. Before a file is chosen, show only one upload surface and one short sentence explaining the outcome. Do not mount empty previews, settings, disabled export buttons, or results panels on the entry screen.
- Keep page identity to a quiet back link and small tool name in one row. No separate hero, tagline, repeated heading, or introduction on tool pages. The home page is a compact tool chooser.
- After upload, content owns the screen. Place one compact toolbar beside it; edit directly on the preview wherever possible. Avoid separate cards for preview, upload, settings, timing, and export. Replace the entry uploader with a small Replace action.
- Defaults must produce a useful result without opening settings. Reveal secondary options only on request, and show results only when work begins or completes. Offer the completed result in the existing workspace instead of stacking another preview below it.
- Optimize for repeat use: no permanent tutorials or repeated helper paragraphs. Put explanations, shortcuts, formats, and compatibility details behind an accessible (?) popover. Keep essential action labels visible; minimal does not mean mysterious unlabeled icons. Errors and active progress stay visible, and material download/time notices appear at the relevant action.
- Help and settings must work by tap, click, and keyboard, dismiss with Escape, and return focus to their trigger. Do not use hover-only help. Disable editing during export so the saved result matches the preview.

## Design and voice
- Follow the spirit of `personal/main`: charcoal background, neutral gray text, system sans-serif type, quiet links, modest headings, generous breathing room, and a little dry personality. The product is the page; skip marketing heroes, gradients, decorative badges, oversized headings, and nested cards.
- Tool pages are dark by default, independent of the device theme. Use shared shadcn neutral tokens, subtle borders, small radii, and color only when it explains state or distinguishes editable media regions.
- Use shadcn/Radix components for shared UI (especially buttons), not a new hand-built component system. Keep native media and form controls when they offer better device integration. Typography used inside exported media can differ from the UI.
- Show the useful first action immediately. Choose sensible defaults, keep one clear primary action per step, and reveal optional settings progressively. Keep previews and results close to their controls.
- Write short, concrete, sentence-case copy: “Choose a video”, “Save video”, “Your video stays on this device.” Avoid hype, feature pitches, technical implementation detail, and repeated instructions. Explain download size, format, processing time, or compatibility only where it affects a decision.
- Support narrow phones, landscape screens, touch, mouse, keyboard, and zoom. Use fluid layouts, visible focus, accessible names, comfortable touch targets, and reduced-motion support. Never make a required action hover-only, drag-only, or dependent on a tooltip. Provide keyboard alternatives for media manipulation.
- Preserve the compact Astro/React architecture; the personal site's single HTML file is a visual reference, not an implementation template.

## Validation
- Run `bun run build` after application changes and check affected interactions in the browser when available. Run relevant existing tests for changed logic.
- Documentation-only edits do not need a build.
