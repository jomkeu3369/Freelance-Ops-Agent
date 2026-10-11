# Frontend dependency audit — 2026-10-11

## Scope and result

The baseline is `main` commit `9a48b5d18672f02fdcb30269b1dffc3f0a414d24`.
This review covers `frontend/package.json`, its npm lockfile, and the application
configuration relevant to the reported advisories. It is not a penetration test
or an assertion about the version currently deployed to production.

The baseline npm audit reports **5 high-severity package entries**:

- `next@16.3.6`, a direct runtime dependency, aggregates six advisories.
- `@next/eslint-plugin-next → fast-glob → micromatch → braces` accounts for the
  other four entries. These all stem from the same existing development-only
  `braces` advisory, rather than four independent application vulnerabilities.

The patch updates `next` and `@next/eslint-plugin-next` together to **16.3.8**,
with matching `@next/env` and platform SWC binaries in the lockfile. This is the
first patched version identified by the advisories; no minor/major upgrade,
forced audit fix, override, or unrelated dependency refresh is included.
`sharp@0.35.5` remains unchanged.

After a clean install:

- `npm audit --omit=dev --json`: **0 vulnerabilities**.
- `npm audit --json`: **4 high package entries**, all from the unchanged
  development-only `braces` chain described below.

These counts are an npm advisory-database snapshot from 2026-10-11, not a
permanent security guarantee. The Next advisories were published to the GitHub
Advisory Database on October 7; this review does not treat the older braces
finding as new.

## Next.js applicability before the patch

The official [16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8)
and npm registry confirm the compatible security patch. Application-source
inspection gives the following narrower exposure assessment:

| Advisory | Required surface | Repository finding |
| --- | --- | --- |
| [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), image SSRF | Attacker-controlled allow-listed remote image host | `next.config.ts` has no `images.remotePatterns`; the advisory says apps without that configuration are unaffected. |
| [GHSA-3w37-wq28-93x7](https://github.com/advisories/GHSA-3w37-wq28-93x7), Draft Mode cache leak | Cache Components / experimental use-cache plus draft-dependent previews | No `cacheComponents`, `use cache`, or `draftMode` usage found in application source/config. |
| [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676), self-hosted SSG/ISR cache poisoning | Pages Router SSG/ISR on self-hosted Next | The project uses App Router and standard Vercel configuration; no Pages Router directory exists. The advisory excludes Vercel. Actual hosting was not independently audited. |
| [GHSA-f87g-xv8r-7p7x](https://github.com/advisories/GHSA-f87g-xv8r-7p7x), metadata-image route bypass | Webpack metadata-image routes relying on `dynamicParams` restrictions | No generated `opengraph-image`/`twitter-image` routes, `dynamicParams`, or `generateStaticParams` found. Metadata points at the static `/og.png`. |
| [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p), response-cache poisoning | Root catch-all page together with SSG/ISR | No root catch-all page exists; the dynamic project/token routes are ordinary named segments. |
| [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv), development MCP disclosure | Developer runs `next dev` and visits a malicious origin | `npm run dev` does run `next dev`, so this development surface is relevant. Production `next start` does not serve that endpoint. |

Thus the runtime high-severity package warning is not evidence of a confirmed
remote exploit against this application. The compatible patch nevertheless
removes the affected dependency and fixes the relevant development-server issue.

## Residual development-only finding

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects `braces <=3.0.3`; both the advisory and registry show no patched braces
release on the review date. Deeply nested patterns can exhaust the Node stack.

`npm ls next @next/eslint-plugin-next braces micromatch fast-glob sharp` resolves:

```text
@next/eslint-plugin-next@16.3.8 (dev)
└── fast-glob@3.3.1
    └── micromatch@4.0.8
        └── braces@3.0.3
next@16.3.8
└── sharp@0.35.5
```

The lockfile marks the complete braces chain as development-only. The plugin's
`get-root-dirs.js` calls `fast-glob` for an explicitly configured
`settings.next.rootDir` pattern. The repository's ESLint config has no such
setting, and application code does not import this dependency chain. No path
from a user's HTTP input to these lint patterns was found.

The remaining risk is local/build-tool denial of service if untrusted brace
patterns are introduced into tooling that invokes this parser. Keep lint
configuration and glob patterns review-controlled; do not feed application user
input into this chain. Recheck the official advisory and registry before a
future compatible toolchain update. This is a scoped risk assessment, not a
blanket audit suppression.

With registry metadata available, npm proposes downgrading the Next ESLint
plugin to `14.2.35` as a semver-major audit fix. That would decouple lint tooling
from Next 16, so it is deliberately not applied. No unsupported braces override
or removal of lint rules is used to make the count disappear.

## Verification

Node **22.23.3**, npm **11.9.0**:

- Clean `npm ci` succeeded with the committed lockfile.
- `npm run ci:check`: TypeScript passed, **464/464 tests passed**, ESLint passed.
- `NEXT_TELEMETRY_DISABLED=1 VERCEL=0 NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run build`:
  standard **Next 16.3.8 Turbopack production build passed**.
- Production and full audit results are separated above; the full audit still
  returns a nonzero exit code for the documented braces finding.
- Local Chromium launch was blocked before application execution by the cloud
  sandbox's Unix-socket restriction. It is not counted as a browser test pass.
  The work branch is included in the existing Frontend CI allowlist to run the
  same **239 network-blocked synthetic browser tests** on GitHub's runner.
  Consult that exact commit's workflow result for browser verification.

No real account data, API credentials, backend, OCR service, or paid model calls
were used. No production deployment or main-branch merge is part of this patch.
