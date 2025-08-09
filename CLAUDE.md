# CLAUDE.md - Agent Instructions

## Commands

- Build: `pnpm build`
- Dev: `pnpm dev`
- Test: `pnpm test` (single test: `cd [app/package] && pnpm jest [testname]`)
- Lint: `pnpm lint` (fix automatically: `pnpm lint:fix`)
- Format config files: `pnpm lint:config` (fix: `pnpm lint:config:fix`)

## Code Layout

Shared utility code should go in `lib`.

## Code Style

- Don't use semicolons
- Follow Thesis style guide via @thesis/prettier-config and @thesis-co/eslint-config
- Use default exports for single exports
- In React components:
  - Use function components with explicit return types
  - Avoid prop spreading except in UI components
  - Use relative imports within modules, absolute for cross-module imports
  - Do not add unnecessary comments inside jsx
  - Avoid prop drilling - keep state local to components that need it
- Always use kebab-case for CSS class names, string enum or union type values, and any other case where syntax allows for it.

### TypeScript and JavaScript 

- Use TypeScript with explicit types (avoid `any`)
- Prefix unused variables with underscore (_varName)
- Always camelCase for variables, functions, classes (PascalCase), etc.
- Prefer named functions over anonymous functions assigned to named consts.
- Prefer named classes over anonymous objects assigned to named consts.
- ALWAYS use `type =` over `interface` unless the desired functionality is impossible with type aliases.
- ALWAYS use string type unions over enums unless enums bring something that can't be achieved with type unions.
- Avoid types files or directories; instead define and, where necessary, export, types from the files where the corresponding data is actually being managed. This also means avoiding defining types in top-level files---they should be defined in the file where most of the interaction with data of that type happens.
- Prefer using comprehensive union types over optional properties in places where a type can cover all possibilities while avoiding optionality.
- Never use || where ?? is a more expressive operator.
- For errors: Use try/catch blocks and provide helpful error messages.
- Don't provide deep error messages in HTTP responses; log them and provide a high-level error to the client.
- Validate all data using zod, and use it to confirm types. NEVER cast JSON objects using `as`, ALWAYS use zod validation. Use zod v4 as described in https://zod.dev/v4 .

### Cloudflare Workers

- Use tslog rather than the console for logging, configured to emit JSON when running in the workers environment and pretty print in the local wrangler environment.

### UI files (HTML, React components, Web components, and similar things):

- Always adhere to WCAG 2.0
- Always use fieldsets instead of divs to contain multiple fields
- Always set up fields as ordered lists of fields from a DOM perspective, without showing that structure in CSS.
- Work as hard as possible to create semantic markup instead of using divs for everything.
- When using a div or span with a single child, consider whether it could be removed and its attributes passed on to the child instead.
- When using a div with relatively simple contents, consider whether a paragraph element would be a better semantic fit.

### Git commits
- Don't commit changes to conventions at the same time as other changes.
- Create a commit for each logical cohesive step in an implementation.
- Use concise prose commit messages explaining why we made a change in addition to what happened. Wrap at 80 chars.
- Run linting, type-checking, and tests before every commit---make sure each one runs.

### Financial Precision Guidelines

- **NEVER** use `parseFloat()`, `Number()`, or `toFixed()` with financial values
- Use utilities from `@thesis-co/cent`, including `Money()` for currency amounts
  and calculations, and `FixedPoint()` for precise decimal arithmetic
- Avoid `.toNumber()` calls except when absolutely necessary (e.g., simple integer counts)
- Use `Money.toString()` with formatting options for display instead of manual formatting
- For exchange rates, use `ExchangeRate.average()` for multi-source calculations
- In new database tables, store amounts as `DECIMAL` and currencies by their ISO-4217 code ("USD", "ARS") or their commonly used cryptocurrency ticker ("BTC", "ETH")
  - Always store financial amounts in the base asset ("USD") rather than the fractional unit ("cents").
  - Ensure `DECIMAL` columns have enough precision to store the smallest unit of the currency.
- **ALWAYS** cast DECIMAL database columns to `::text` in Supabase queries to prevent precision loss
  - Example: `amount::text`, `price::text`, `balance::text`
  - The Supabase client converts DECIMAL to JavaScript number by default, losing precision
- Example patterns:
  ```typescript
  // ✅ Good - preserves precision throughout
  const amount = Money("USD 123.45")
  const result = amount.multiply("1.03")
  const display = result.toString({ compact: true })

  // ❌ Bad - loses precision
  const amount = parseFloat("123.45")
  const result = amount * 1.03
  const display = result.toFixed(2)

  // ✅ Good - cast DECIMAL columns to text in queries
  const { data } = await supabase
    .from("orders")
    .select("*, total_amount::text")

  // ❌ Bad - DECIMAL becomes JavaScript number
  const { data } = await supabase
    .from("orders")
    .select("*") // total_amount loses precision
  ```
### Complex UI Components
- Check for existing UI components in `packages/ui-v2` and import UI components using the namespace pattern: `import * as ComponentName from "@repo/ui-v2/component-name"`
- Use compound component pattern: split complex components into Root + sub-components
- Export pattern: ComponentName as Root, ComponentSubname as Subname
- Import pattern: import * as ComponentName from '@repo/ui/component-name'
- Usage pattern: <ComponentName.Root><ComponentName.Icon /></ComponentName.Root>
- Always include a Root component as the main container
- Sub-component names should be descriptive: Icon, Trigger, Content, Item, etc.
- Use forwardRef for all components that render DOM elements
- Support polymorphic behavior with as or asChild props where appropriate
- Use tailwind-variants (tv) for complex styling with variants, compound variants, and default variants
- Set display names for all components using constants
- Pass shared props down to sub-components using recursiveCloneChildren utility
- Support className prop for custom styling overrides
- Use Radix UI primitives as the foundation for complex interactive components
