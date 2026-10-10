# A repository says how each attribution key leaves the machine

**Date**: 2026-10-10. **Status**: decided at the plan gate of task C003 by the orchestrating
agent on the owner's behalf, the owner being away
(`docs/autopilot/decisions/C003-privacy-controls-over-attribution.md`); three of those decisions
were marked as the owner's and are the owner's to confirm or reverse before a release.
Implemented with this document.

**It continues [`specs/attribution-rules/decision.md`](../attribution-rules/decision.md)**, which
is not edited. That document's last known limit — "omitting or hashing a dimension is not here" —
is what this one closes, and its reason for reading the rule file fail-closed is what this one
relies on.

## The problem

Since a repository can declare attribution rules, what a committed pattern captures of a branch
name, or of the name declared in `AGENTMETER_SOURCE`, is sent as captured. A branch name describes
how a private repository is organised, and the service — and everyone who reads its dashboard —
learned it. The only alternative was not to capture it, and then the service could not group by it
either.

No dimension is derived from a path: the set of sources is closed at those two.

## What was decided

**A version 2 `.agentmeter.json` says, on every `emit` entry, how its key is sent.**

```json
{
  "version": 2,
  "hashSalt": "<generate one: 32 to 128 characters>",
  "attribution": [
    {
      "from": "branch",
      "match": "^(?<task>[A-Z][0-9]{3})-(?<rest>.+)$",
      "emit": [
        { "type": "task", "key": "{task}", "send": "plain" },
        { "type": "work", "key": "{rest}", "send": "hashed" }
      ]
    }
  ]
}
```

| `send` | What leaves the machine |
| --- | --- |
| `"plain"` | The key as built. |
| `"hashed"` | `hashed:` and 32 hexadecimal characters. |
| `"omitted"` | Nothing. The entry's rule still counts as the first match of its source. |

- **There is no default treatment.** An entry of a version 2 file that does not say, or says a
  word that is not one of the three, invalidates the whole file. A default of `plain` sends a
  dimension added later in clear because nobody thought about it; a default of `hashed` or a
  refusal of version 1 files silently changes, or stops, what a released version's users send,
  and a label lost meanwhile cannot be applied again from the collector.
- **A version 1 file is read exactly as 0.3.0 read it**: every key as built. `send` and
  `hashSalt` are not keys of a version 1 file and invalidate it as any unknown key does.
- **It is configured in the committed file and nowhere else.** One reviewed place says what
  leaves the machine and how, the same for every contributor, and there is no precedence to
  define. Not an environment variable, not a flag of the command a hook runs, not a file-wide
  default.
- **The whole key is treated**, the template's literal text included: a literal left beside a
  digest tells a reader what the digest is of. The `type` is never treated: it is a constant the
  repository wrote, derived from nothing on the machine, and the service groups by it.
- **The same entries are dropped under every treatment** — a group that took no part in the
  match, an empty key, a key over 128 characters before treatment — so changing how a key is
  sent never changes which turns are labelled.

## The digest

`hashed:` followed by the first 128 bits, as 32 lowercase hexadecimal characters, of
HMAC-SHA-256 computed with the file's `hashSalt` over the JSON text of the pair `[type, key]`.
`node:crypto`, a Node built-in.

- **The pair, not the key alone**, so that a type and a key cannot be re-split into another pair
  and one text under two types does not show as one value.
- **128 bits**: collisions are out of reach for any number of keys a project has, and the whole
  digest would only be harder to read.
- **The mark is in the key.** The service stores a type and a key and does not know what either
  means; a field on the wire saying "this one is hashed" would change the ingestion contract and
  teach it. A reader of a dashboard tells a digest by its prefix. A plain key of a version 2 file
  that would begin with `hashed:` is dropped, so in what such a file sends the prefix is never
  anything else. A version 1 file's keys are not checked for it: they are sent as they always
  were.

### The salt, and what it is not

**The salt is committed, in the rule file.** `hashSalt` is 32 to 128 characters of `A–Z`, `a–z`,
`0–9`, `_` and `-`; it is required when any entry says `hashed`, and a salt that is present and
not within those bounds invalidates the file whether or not an entry uses it.

A digest with no salt hides a branch name only from someone who does not try: names and task ids
are short, and anyone can hash every likely one and compare. So the digest is salted with
something the reader it is meant to stop does not have.

- **Whom it stops**: someone who reads the service's data and cannot read the repository.
- **Whom it does not stop**: anyone who can read the repository. They have the salt — and they
  already read the branch names.
- **In a public repository it stops nobody.** `omitted` is the treatment there.
- **It is not a credential**, and nothing here calls it a secret. It is not anonymity either: a
  digest still says that two measurements belong to the same thing.
- **If a private repository is opened later**, every digest already sent under its salt becomes
  guessable.

Why committed rather than in each contributor's environment: the only reason to hash rather than
omit is that the service can still group by the value, and that needs every machine to compute
the same one. A value handed round out of band makes one task as many series as there are
machines the moment two differ, with nobody told, and a machine without it leaves its turns
unlabelled for good. Committed, every checkout agrees by construction, and against the reader it
is for it is exactly as strong.

The salt is never sent, queued, printed or reported; a failure names the check, never the value.

## Fail closed

| What is wrong | Result |
| --- | --- |
| An entry of a version 2 file with no `send`, or with a word that is not one of the three | The whole file is invalid, `undeclared-treatment`: no dimensions at all. |
| `hashed` with no `hashSalt`; a `hashSalt` out of bounds | The whole file is invalid, `invalid-hash-salt`. |
| `send` or `hashSalt` in a version 1 file | The whole file is invalid, `unknown-key`. |
| Computing a digest raises, or does not come back as 32 hexadecimal characters | That entry is dropped. |

In every case the measurements are submitted, without dimensions or without that one, and the run
never fails a session. The whole file is refused rather than the entry at fault because that is
the rule the file is already read by.

A 0.3.0 collector reads a version 2 file as an unsupported version and sends no dimensions. That
is the reading C002 put there for this.

## How it is enforced

- **The treatment is applied where a key is built**, in `src/attribution/attribution-rules.ts`,
  before a dimension exists as a value. One function turns a plain key into what is sent, and it
  has one path that returns the plain key: the entry says `plain`. A key that is hashed or
  omitted therefore never reaches a turn, a request, the queued file, the outcome or the printed
  line. Extraction, the projection, the contract types and the pinned copy of the service's
  document did not change.
- **A compiled entry cannot exist without a treatment**: it is a required field of a closed
  union, and that function switches over it exhaustively, so a treatment added later does not
  compile until it is handled.
- **A hashed entry holds the file's salt itself**; nothing else carries it.
- **`test/unit/contract/content-safety.unit.test.ts` runs every source against every treatment**,
  from the collector's own exported closed sets (`RULE_SOURCES`, `TREATMENTS`). Its tables are
  keyed by those sets: a source or a treatment added later has no case, the types refuse to
  compile and the suite fails. The plain value and the salt are markers, and must occur nowhere.
- **`test/unit/run/run-collector.unit.test.ts` holds the same through a whole run**: the file the
  queue wrote, the request, the outcome, the printed line and whatever was written to the
  process's streams.
- **The digest is pinned** against an HMAC the test computes without the collector.

## What it costs

- **A second version of the file to read**, with no end date for the first.
- **A team moves its file when every collector knows version 2.** Until then an older collector
  sends those turns unlabelled, and a label is fixed when a measurement is first delivered.
- **Changing the salt, an entry's `type`, or a key from `plain` to `hashed` starts a new series**
  on the service. What was delivered plain stays as delivered.
- **The plain key exists in memory for the length of a run**, inside the attribution module: the
  match, and the memory of what each branch gave. It is written nowhere.

## Not here

A treatment one developer applies on top of the repository's; hashing a `type`; hashing only what
the groups captured; a count of how many dimensions were hashed or omitted; a path or a session's
name as a source.
