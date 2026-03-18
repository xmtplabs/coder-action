# Adding a New Mode

1. **`src/schemas.ts`** — Add a new `z.object({ action: z.literal("new_mode"), ... })` schema to the discriminated union and export its type.
2. **`src/handlers/new-mode.ts`** — Create handler class with `constructor(coder, github, inputs, context)` and `run(): Promise<ActionOutputs>`.
3. **`src/handlers/new-mode.test.ts`** — Cover happy path and key error paths.
4. **`src/index.ts`** — Add `case "new_mode":` to the switch, extract the relevant payload fields, instantiate and call the handler.
5. **`action.yml`** — Document the new value in the `action` input description; add any new inputs/outputs.
6. **Rebuild** — `bun run build` and commit `dist/index.js`.
