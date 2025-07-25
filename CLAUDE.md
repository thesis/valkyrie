# CLAUDE.md - Agent Instructions

## Commands

- Build: `pnpm build`
- Dev: `pnpm dev`
- Test: `pnpm test` (single test: `cd [app/package] && pnpm jest [testname]`)
- Lint: `pnpm lint` (fix automatically: `pnpm lint:fix`)
- Format config files: `pnpm lint:config` (fix: `pnpm lint:config:fix`)

## Code Layout

Shared utility code, like currency formatting, should go in `packages/shared/src/`, and be imported elsewhere via the `@repo/shared` module.

Remember to update gitignore entries at the top level rather than managing a ton of subfiles.

## Code Style

- Don't use semicolons
- Follow Thesis style guide via @thesis/prettier-config and @thesis-co/eslint-config
- Use default exports for single exports
- Use TypeScript with explicit types (avoid `any`)
- Never ignore a lint error without asking me
- Prefix unused TypeScript variables with underscore (\_varName)
- Name variables in camelCase, classes in PascalCase
- In React components:
  - Use function components with explicit return types
  - Avoid prop spreading except in UI components
  - Always specify button type attribute
  - Use relative imports within modules, absolute for cross-module imports
- Always use kebab-case for CSS class names, string enum or union type values, and any other case where syntax allows for it.
- Always camelCase for JavaScript and TypeScript variables, functions, classes, etc.
- In TypeScript and JavaScript:
  - Prefer named functions over anonymous functions assigned to named consts.
  - Prefer named classes over anonymous objects assigned to named consts.
  - Always use `type =` over `interface` unless the desired functionality is impossible with type aliases.
  - Always use string type unions over enums unless enums bring something that can't be achieved with type unions.
  - Avoid types files or directories; instead define and, where necessary, export, types from the files where the corresponding data is actually being managed. This also means avoiding defining types in top-level files; they should be defined in the file where most of the interaction with data of that type happens.
  - Prefer using comprehensive union types over optional properties in places where a type can cover all possibilities while avoiding optionality.
    In Cloudflare Workers:
  - Use tslog rather than the console for logging, configured to emit JSON when running in the workers environment and pretty print in the local wrangler environment.
  - Never use || where ?? is a more expressive operator.
- In UI files (HTML, React components, Web components, and similar things):
  - Always adhere to WCAG 2.0
  - Always use fieldsets instead of divs to contain multiple fields
  - Always set up fields as ordered lists of fields from a DOM perspective, without showing that structure in CSS.
  - Work as hard as possible to create semantic markup instead of using divs for everything.
  - When using a div or span with a single child, consider whether it could be removed and its attributes passed on to the child instead.
  - When using a div with relatively simple contents, consider whether a paragraph element would be a better semantic fit.
- When doing git commits:
  - Don't commit changes to conventinos at the same time as other changes.

Errors: Use try/catch blocks and provide helpful error messages.
