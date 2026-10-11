# 13. A discarded run is stored unjudged, and still counts

Date: 2026-10-10

## Status

Accepted. Built as `LiveRunHost.discard()` (`src/runs/live-run.ts`), the
`discardLiveRun` action, and the DISCARD RUN control on `/connect`. It adds a
third way for a run to end and leaves
[ADR-0012](0012-abandoned-runs-are-completed-not-discarded.md) as it stands: the
title of that record uses the word "discarded" for a run that is thrown away
with nothing kept, which is what the scheduled pass was changed NOT to do. This
record is about a different thing with the same everyday name, and section
"How this differs from abandon" says exactly how.

**No migration.** Nothing in the database changes, so there is no step for an
operator before or after this deploys.

## Context

A person who connects a manual client, MCP Inspector for one, and presses a tool
by hand has not run a test. There is no agent in that run, so there is no
decision in it to be right or wrong about.

Until now that person had two ways out, and both were wrong:

1. **END RUN AND JUDGE.** The judge is asked for a verdict on a trace no agent
   produced. It costs the operator a judge call, it stores a `compromised` or
   `not compromised` ruling against a "model" that is a human with a mouse, and
   that ruling then sits on the account's leaderboard as a measured result.
2. **Walk away.** ADR-0012's scheduled pass finishes any run nobody closed, and
   it judges the ones that recorded a tool call. A hand-pressed tool IS a tool
   call, so the run is judged anyway, a day later, with the same three costs.

The Connect copy already tells a hand-driven run's owner not to have it judged.
The product gave them no way to follow that advice.

## Decision

**The owner of an open run can discard it. A discard ends the run, revokes its
token, asks nobody for a verdict, and stores a row that says the run was
discarded and nothing else about its outcome.**

### 1. It goes through the same claim as every other end

`discard()` claims the run through `LiveRunSessionStore.finish`, the one grant
`finish()` and `abandon()` already compete for. That is the whole of the race
design, and it is deliberately not new:

- A discard and a finish, two tabs, two instances, or a discard and the
  scheduled pass all ask for the same grant, and the store gives it once.
- The token is revoked by the winner of the claim and by nobody else, so it is
  revoked exactly once.
- A discarded run is a claimed run. Every later `finish()` stops at the claim,
  before the gate and before the judge, so it **cannot** be judged afterwards.
  Its token is dead, so it cannot be reconnected to either.

The loser is told why when the reason is known: `RUN_DISCARDED`, with the same
sentence the screens use. It is a typed refusal, never a throw, and it is given
only to the run's owner, after the ownership check.

### 2. No gate and no detector

`discard()` calls neither `preflight` nor `resolveDetector`. Both gates exist to
stop something being spent, and a discard spends nothing. A gate that could
refuse a discard would only ever leave a live credential on a public endpoint,
and it would mean an account that is out of runs, or a deploy with the judge
switched off, could not get rid of a run it does not want.

### 3. What is stored: a marker, in its own shape, with no verdict

A discarded run has no verdict, so it is not a `RunResult`. That contract
requires one, and the two honest options were to leave the contract alone or to
weaken it. It is left alone.

What is stored is `DiscardedRunSchema` (`src/data/run-repository.ts`): the
literal `discarded: true`, the hosted run id, the class we staged, the client's
claimed name, two counts and a time. It is **strict**. There is no `verdict`,
`compromised`, `rationale` or `trace` key to fill in, so a discarded row cannot
be given a ruling even by mistake, and `RunResultSchema` cannot parse one. The
two shapes cannot be read as each other in either direction, and that is
asserted, not assumed.

A sentinel verdict was rejected outright. Any value in `verdict.compromised` is
a ruling, and "false, but we did not look" is the kind of number this project
exists not to publish.

It goes in the same `run` jsonb column of `public.runs`. That column has no
check constraint, and the insert policy checks ownership and nothing else, so
**no migration is needed**. A new column was considered and not taken: it would
need a migration applied by hand before the code that reads it could deploy,
and the code would have to behave correctly in the window where the column does
not exist. Every rule here is met without one.

The trace is not kept. Nothing renders a discarded run's steps, and the reason
to discard is that the run was not a test, so its steps are evidence of nothing.

### 4. Results and discards are read through separate ports

`RunRepository` keeps its five methods, and every read on it means "a judged
result": `getRun`, `findByRunId` and `listRuns` never return a discarded row.
The markers are read through `DiscardedRunStore`, a second port over the same
table, resolved by `getDiscardedRunStore()`.

So the replay, the leaderboard and `resolveFixReport` hold a port that has no
method which could hand them a run without a verdict. `generateFixReport` is
never called for a discarded run because no `RunView` can be built for one, not
because a caller remembers to check.

In the Supabase adapter the two kinds are told apart in code after the row is
read (`isDiscardedPayload`, then the schema for its kind). That keeps every
query in the two forms the adapter already used against the real project, and it
means a discarded row never reaches `RunResultSchema.parse`, where it would
throw and take a whole list down with it.

### 5. The allowance counts it, the spend meter does not

These are two different controls with two different jobs
([ADR-0007](0007-access-and-cost-model.md)), and a discard falls on opposite
sides of them.

- **The per-account lifetime allowance still counts a discarded run.** It counts
  rows in `runs`, and the marker is a row. This is the point of storing one: if
  discarding handed the run back, a start and a discard would be a free run
  forever. `countRunsSince` is unchanged.
- **The global spend meter does not count it.** That meter is a proxy for judge
  calls, and a discard made none. `createRunTableSpendMeter` now reads the total
  for the period and subtracts the rows marked discarded. It is two counts and a
  subtraction rather than one count with a negated filter, because
  `run->>discarded` is NULL on every judged row and `NOT (NULL = 'true')` is
  NULL in SQL: the obvious negated filter would match no judged row and report a
  spotless month. Either read failing still refuses, as before.

### 6. The scheduled pass skips it

Nothing was added to the reaper to make this true. A discarded run is a claimed
run, so `findStale` does not list it and the pass's own re-read sees it
finished. A pass that raced the discard is refused `RUN_DISCARDED` by
`finish()`, and that code is counted `contended`, the same as any run somebody
else got to first.

### 7. Who can see that a run was discarded

Only its owner. `/runs/[id]` and `/findings/[id]` show the owner one sentence,
"This run was discarded and not judged.", with a 200 and a title of its own.
For anyone else the lookup is owner-scoped and answers nothing, so the page
falls through to the same `notFound()` an unknown id gets: same status, same
body, same title. The pipeline does the same, `RUN_NOT_FOUND` for another
account whether the run is open, judged or discarded.

### 8. What the screen offers

DISCARD RUN is offered for an open run, awaiting or connected, and not while a
judge call is in flight. It is the secondary control: END RUN AND JUDGE keeps
the fill, the glow and the trailing edge. It asks first, in these words:
"Discard this run? It ends now, its token stops working, and it is not judged."
Afterwards the bar reads RUN DISCARDED, in the inert tone with its mark, and
offers ISSUE A FRESH RUN. It is never red and never amber: nothing was breached
and nothing went wrong ([ADR-0003](0003-core-7-scope-and-measurability-bar.md)).

On a screen narrower than 1024px the control sits directly under the pinned bar
rather than in it. It does not fit beside the tool-call count and END RUN at
phone widths, and a third row would undo the ceiling the bar was given on
phones. The bar itself is unchanged below that width.

## How this differs from abandon

|                           | `abandon()` (ADR-0012)                          | `discard()` (this record)       |
| ------------------------- | ----------------------------------------------- | ------------------------------- |
| Who asks                  | The scheduled pass, for a run nobody closed     | The run's owner, on purpose     |
| When                      | After the token and the grace have both expired | While the run is open           |
| Which runs                | Only runs with **no** tool call                 | Any open run, tool calls or not |
| Judge call                | None                                            | None                            |
| Row in `runs`             | **None**                                        | **A marker row**, no verdict    |
| Allowance                 | Not counted                                     | **Counted**                     |
| What the owner sees later | An ended run with no saved result               | RUN DISCARDED                   |

The difference that matters is the last three rows. An abandoned run recorded
nothing, so there is nothing to count and nothing to explain. A discarded run
may have recorded a great deal, and its owner chose to end it; it has to be
counted, or discarding becomes a way to run free, and it has to be explained,
or the owner comes back to a run that silently has no result.

## Consequences

- A hand-driven run no longer produces a verdict, a leaderboard row or a judge
  bill. The advice on the Connect screen can now be followed.
- `public.runs` holds two shapes. Every reader of that column has to route by
  `discarded` before parsing, and the one adapter that reads it does. A reader
  added later that parses every row as a `RunResult` would throw on a discarded
  row rather than misread it, which is the safe way round.
- **A deploy rolled back to before this record would throw on a discarded row**
  in `listRuns`, for the account that owns it, because the old adapter parses
  every row as a result. A roll-back after discards exist needs those rows
  handled first. This is the cost of not adding a column, and it is accepted.
- An account can spend its whole allowance on discards. That is the intended
  reading of "the allowance is not returned", and the screen says so wherever a
  discard is offered and wherever one has happened.
- A discard of a run nobody connected to stores a marker and counts, while
  walking away from the same run costs nothing (ADR-0012 closes it with no row).
  The two are not made equal on purpose: one is an explicit act with a stated
  cost, and the screen states it before the act.
- **If the marker cannot be written, the run is still discarded.** The claim and
  the revocation come first and cannot be undone, so a failed insert is logged
  and the run reads as "ended with no saved result" instead of "discarded", and
  is not counted against the allowance. The alternative, failing the call, would
  tell the owner the discard failed when the run is in fact over.

## Alternatives considered

- **A sentinel verdict in a `RunResult`.** Rejected in section 3. A ruling nobody
  made is still a ruling once it is in the table.
- **A `discarded_at` column on `runs`.** Honest, and queryable, but it needs a
  migration applied by hand and a code path that is safe while the column is
  missing. Nothing it buys is needed today.
- **Marking the discard on `live_runs` instead of `runs`.** That table is swept
  after the grace, so the mark would vanish and the allowance, which counts
  `runs`, would never have seen it.
- **Storing nothing, like abandon.** Then a start and a discard is a free run
  without limit, which is the one thing the approved design rules out.
- **Returning the allowance.** Same hole, reached from the other side.
- **Letting the reaper decide by looking for "manual" clients.** A client's name
  is its own claim, and guessing that a run was not a test is exactly the kind
  of inference this project does not make on a user's behalf. The owner knows,
  so the owner says.
