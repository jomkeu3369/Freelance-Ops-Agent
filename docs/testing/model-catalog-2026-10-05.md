# Model catalogue and tariff verification — 2026-10-05

Base: `cfcaeb939129e290e7fbd8ae115414d44f361e5f`. No paid calls, SDK upgrades,
production changes, main merge or account/global limit increases are part of this work.
The selected base does not track AGENTS.md, .agents/skills or docs/STATUS.md;
the existing checkout's AGENTS.md, service READMEs and accepted ADRs were inspected.

## Official sources and Standard USD per million text tokens

| Exact ID / source | Input | Cached read | Cache write | Output | Supported app reasoning |
| --- | ---: | ---: | ---: | ---: | --- |
| [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | .10 | .01 | .125 | .50 | NONE, LOW, MEDIUM, HIGH |
| [gpt-6-sol](https://developers.openai.com/api/docs/models/gpt-6-sol) | 2 | .20 | 2.50 | 10 | NONE, LOW, MEDIUM, HIGH |
| [gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 2 | .10 | 2.50 | 10 | LOW, MEDIUM, HIGH |
| [gpt-6-astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 10 | 1 | 12.50 | 50 | LOW, MEDIUM, HIGH |
| [gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | .20 | .02 | .25 | 1.20 | NONE, LOW, MEDIUM, HIGH |
| [gpt-5.6-terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 2 | .20 | 2.50 | 12 | NONE, LOW, MEDIUM, HIGH |
| [gpt-5.6-sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 4 | .40 | 5 | 20 | NONE, LOW, MEDIUM, HIGH |

Fetched exact model pages on 2026-10-05. Sol 5.6 promotional pricing is guaranteed
at least through 2026-11-21: new platform attempts fail closed from 2026-11-22 UTC
until an operator reviews and versions the tariff. Historical settlement stays valid.
No `gpt-6` alias. Actual account model permissions are unverified.

`platform-ai-2026-10-04-v1` remains a two-model immutable tariff. New reservations
pin `platform-ai-2026-10-05-v2`; settlement never substitutes the latest version.
V42 copies the existing Luna run cap to both Lunas and the existing Terra cap to
each other exact model. These are separate operator-editable rows. Existing
account/week, global/day and global/week settings remain unchanged; spend is off.

The priced path is text-only Responses, official `https://api.openai.com/v1`,
Standard `service_tier=default`, no provider tools, bounded retries, <=272,000
input tokens. Regional endpoints, fast/flex/batch tiers, images, embeddings,
search and other unpriced paths remain blocked. Output already contains reasoning.
Missing cache-write/read details retain the call's conservative pre-call bound.

## Cost-proportional weekly allowance direction

The newer user instruction replaces model-fixed credit charges. V42 intentionally
does not add the proposed 5/100/500 credit rows or increase the weekly 100 value.
The catalogue is not proof of credit, cash, operator enablement or provider access.
The follow-up V43 implements precise USD usage and remaining/reserved percentages.

Planning estimates, not observed usage (uncached Standard text, no retries):

| Scenario / total main tokens + 5.6 Luna route tokens (input/output) | 6 Luna | 6.1 Sol | 6 Astra |
| --- | ---: | ---: | ---: |
| Short conversation: 2k/500 + 2k/200 | $0.00109 | $0.00964 | $0.04564 |
| File analysis: 50k/3k + 2k/200 | $0.00714 | $0.13064 | $0.65064 |
| Quote/proposal across calls: 60k/8k + 3k/500 | $0.01120 | $0.20120 | $1.00120 |

At the unchanged $1.25 account/week setting these are approximately 111 Luna
quote workflows or 6 Sol workflows before retry/cache-write headroom. Recommend
6 Luna as the catalogue default; users can explicitly choose costlier models.
Actual prompt/context sizes can differ substantially. No allowance increase or
paid enablement is implied by these estimates. BYOK main calls use the user's key;
platform-funded routing is still counted against the platform allowance.
