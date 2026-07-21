# XDD Healing Canary

## Automated canary

The repository canary is `extensions/xdd/healing/healing-flow.test.ts`. It drives the production Controller transition reducer through:

```text
verify TRACE_GAP
→ ROLLBACK(execute, structured failure)
→ open HealingCase
→ reject ADVANCE without closure
→ RECORD_HEALING_CLOSURE
→ reject verify ADVANCE without receipt
→ RECORD_VERIFY_RECEIPT
→ close HealingCase and complete
```

The same suite attacks recurrence identity and lifetime rollback accounting. `healing-case.test.ts` attacks owner-scope isolation, stale generation, and subject changes; `artifact-fingerprint.test.ts` attacks touch-only, equal-size replacement, timestamp-only evidence, and escaping symlinks; `stable-findings.test.ts` attacks moving P2 targets while retaining new P0/P1 blockers.

## Real CLI smoke

Run from the repository root:

```bash
pi --model MiniMax/MiniMax-M3 -p hi
```

This checks that the user-scope Pi installation can load. Provider credentials are deliberately not stored in the repository; a missing credential must remain a visible smoke warning rather than being represented as an XDD artifact defect.

## Acceptance

- No target-stage advance without a closure bound to the active failure ID.
- No healing close without a receipt bound to the current generation and subject digests.
- No reuse of pre-rollback reviews in the invalidated target-and-later stage range.
- No flow allowance reset while a HealingCase is active.
- No timestamp, touch, unrelated-path, or newly introduced wording-only P2 change may masquerade as repair closure.
