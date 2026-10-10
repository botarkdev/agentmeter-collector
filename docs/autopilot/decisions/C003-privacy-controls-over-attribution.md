# C003 — autopilot decisions

Decisions the orchestrator took on the human's behalf while this task ran in an autopilot lane
(run 20261009-1). The owner was away; three of the decisions below were marked by the lane as the
owner's, and the orchestrator took them so that the work could be built and read as a whole. They
are named first at hand-off, and nothing is released until the owner merges and releases.

## plan gate

Reviewed: the plan at `725b17d`. Read by the orchestrator: `CLAUDE.md`'s paragraph on
configuration, which says the committed file "holds attribution rules and nothing else" and that
it is read fail-closed "because a later key may say a dimension is to be withheld".

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| D1 | What is a captured value sent as when the file does not say? — *marked the owner's* | A: plain when unsaid · B: hashed when unsaid · C: a second version of the file in which every entry must say, a first-version file read exactly as 0.3.0 reads it · D: as C, first-version files refused | **C** | It is the only option with no default at all: nothing an existing user sends changes on upgrade, and in the new version nothing is sent in the clear because nobody thought about it. B and D silently change or stop what a released version sends, and labels lost meanwhile cannot be applied again. Additive; the next release is a minor either way. |
| D2 | Where is it configured? | the committed file, per entry, and nowhere else · an environment variable · a flag · a file-wide default | **the committed file, per entry** | One reviewed place and no precedence to define; a file-wide default is a new entry sent in the clear by omission. |
| D3 | The treatments | plain, hashed, omitted, on the whole key of any entry · hash the captures only | **whole key** | A literal left beside a digest tells a reader what the digest is of. |
| D4 | Where the value that keys the hash lives — *marked the owner's* | H1: no key · H2: in each contributor's environment · H3: committed in the file | **H3, and it is called a salt, not a key** (`hashSalt`) | The reader a digest must stop is the one who sees the service's data and not the repository; H2 and H3 stop that reader equally, and whoever can read the repository can already read its branches. H2 makes one task as many series as there are machines unless a secret is handed round out of band, and a machine without it leaves its turns unlabelled for good. Committed, it is not a credential and the documents must not call it one: it protects nothing from a reader of the repository, and nothing at all in a public one. It does make `CLAUDE.md`'s "attribution rules and nothing else" stale by a word, which is the owner's file — a row, with the paragraph proposed. |
| D5 | The digest's form | the first 128 bits as hex after the prefix `hashed:`, over the type and the key; a plain key that begins with the prefix is dropped · a field on the wire | **as proposed** | The service does not learn what a dimension means, and a field would change the contract. |
| D6 | A malformed declaration | the whole file invalid, measurements still sent, the session never failed · only the entry | **the whole file** | The file's existing rule, and stronger than dropping one dimension. |
| D8 | A dimension added later | no default in the file, an exhaustive switch in the code, and the content-safety suite failing when a source or a treatment has no case | **all three** | Each alone can be forgotten. |
| D9 | Documents — *marked the owner's in part* | an entry under the changelog's unreleased heading; a row for `CLAUDE.md` with the paragraphs proposed; a row in the other repository for its guide; C002's decision record left as written with a new one beside it | **as proposed** | The changelog entry is the repository's convention for every change. The orchestrator opens the other repository's row. |
| — | Where the verify stage sends | a loopback address with nothing listening · a name under a reserved domain | **loopback** | A reserved name still asks a resolver; nothing should leave the machine. |

## implement gate

Reviewed, uncommitted: twelve modified files and the new decision document; no manifest, lockfile,
fixture, projection or contract file among them. Read by the orchestrator: the one function that
turns a captured key into what is sent, and the digest. Checked by the orchestrator in the
service's own source, which the lane may not read: a dimension's key is any text of 1 to 256
characters, so a digest behind its prefix is accepted as a key like any other. Broken on purpose
by the orchestrator, then restored byte-identical: a digest that raises made to send the plain key
behind the prefix — two cases failed, one in the rules' suite and one through a whole run. As the
lane reports them: 504 tests pass with coverage near 99%, the package builds and checks; twenty
mutations of its own each went red, among them a missing `send` read as plain, an omitted key
sent, and the salt written to a failure's detail.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Commit? | commit · change first | **commit**, as the three commits proposed | The evidence above. |
| 2 | The reserved prefix holds for a second-version file only | accept · both versions | **accept** | Dropping such a key from a first-version file would change what 0.3.0 sends, which D1 ruled out. |
| 3 | A salt present and out of bounds invalidates the file even when nothing is hashed; a digest that is not thirty-two hex characters is dropped | accept | **accept** | Both fail closed. |
| 4 | The run's injected dependencies gain the digest, so a raising one can be shown through a whole run | accept, as an optional field · remove | **accept, optional** | An exported type must not start requiring a field of whoever builds it. |
| 5 | One existing table row used version 2 as its example of an unknown version | approve its change to 3 · revert | **approve** | Version 2 is now known. |
| 6 | "It is not a credential", in negation, in the decision document and a comment | keep · remove | **keep** | Saying what it is not is the honest sentence; the rule was against calling it one. |
| 7 | The plan's body still says `hashKey` | leave, with one line saying the name as built · rewrite | **leave, with the line** | It is the plan as it was approved. |
| 8 | The verify stage | after the commits, against a loopback address with nothing listening | **after the commits** | It runs the built package; nothing leaves the machine. |
