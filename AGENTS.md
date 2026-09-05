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

## Validation
- Run `bun run build` after application changes and check affected interactions in the browser when available. Run relevant existing tests for changed logic.
- Documentation-only edits do not need a build.
