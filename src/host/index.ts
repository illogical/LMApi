import createLmApiAdapter from './adapter';

/**
 * Compiled entry point HomeBase actually loads (dist/host/index.js, per
 * package.json's `build:host` / `tsconfig.host.json`). The real
 * implementation lives in `./adapter.ts`; this file exists only to control
 * the compiled output's CommonJS export shape.
 *
 * **`export =`, not `export default` — load-bearing, do not "simplify"
 * back.** HomeBase's loader (`ApplicationHost.ts`) does
 * `(await import(moduleUrl)).default` against the *raw* dynamic-import
 * result. Node's native CJS/ESM interop sets a CJS module's synthetic
 * `.default` to `module.exports` itself, unwrapped — it does not special-case
 * TypeScript's `__esModule` marker the way `esModuleInterop`/bundlers do.
 * `export default function foo() {}` under `module: commonjs` compiles to
 * `exports.default = foo` (leaving `module.exports` as `{ default: foo,
 * __esModule: true }`), so HomeBase would see `imported.default` as *that
 * wrapper object*, not the factory function, and reject the adapter with
 * "The adapter module has no default export function." `export =` instead
 * compiles to `module.exports = createLmApiAdapter` directly, so
 * `imported.default` resolves to the function as HomeBase expects. Same fix
 * DevPlanner's migration already applied and documented — see that repo's
 * `src/host/index.ts` for the concrete failure this avoids.
 *
 * Kept in a separate file from `./adapter.ts` (rather than putting
 * `export =` directly on the implementation) so `./adapter.ts` stays a
 * normal `export default` module that `src/host/__tests__/` can import
 * without any CJS-interop caveats.
 */
export = createLmApiAdapter;
