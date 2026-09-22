export const meta = {
  name: 'district-policy-night-run',
  description: 'Lease a state, scan its unchecked districts for corporal punishment policy, adversarially check each quote, release the lease',
  phases: [
    { title: 'Claim', detail: 'take a lease per state so no other contributor reads the same districts' },
    { title: 'Scan', detail: 'one agent per batch of four districts, reading each policy at its primary source' },
    { title: 'Check', detail: 'an independent agent re-fetches each source and tries to refute the quote' },
    { title: 'Release', detail: 'give every scope back' },
  ],
}

const SERVER = 'https://escp-mcp-production.up.railway.app/mcp'
const HUMAN = 'a@175g.com'

const CLAIM = {
  type: 'object',
  properties: {
    state: { type: 'string' },
    claimed: { type: 'boolean' },
    lease_id: { type: ['string', 'null'] },
    why_not: { type: ['string', 'null'], description: 'If not claimed: the server\'s exact refusal, including which lease it overlapped' },
  },
  required: ['state', 'claimed'],
}

const FINDING = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          state: { type: 'string' },
          name: { type: 'string', description: 'The district name EXACTLY as given in the input row' },
          nces_id: { type: ['string', 'null'] },
          county: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['allows', 'bans', 'consent_required', 'unknown'] },
          source: { type: ['string', 'null'] },
          quote: { type: ['string', 'null'] },
          source_text: { type: ['string', 'null'], description: 'Only when the source cannot be machine-fetched: the verbatim policy text you read' },
          policy_code: { type: ['string', 'null'] },
          policy_adopted: { type: ['string', 'null'], description: 'YYYY-MM-DD, only if the policy itself prints it' },
          policy_revised: { type: ['string', 'null'], description: 'YYYY-MM-DD, only if the policy itself prints it' },
          students_2023_24: { type: ['number', 'null'] },
          contact: {
            type: ['object', 'null'],
            properties: {
              district_email: { type: ['string', 'null'] },
              board_email: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
              mailing_address: { type: ['string', 'null'] },
              superintendent: { type: ['string', 'null'] },
              board_page: { type: ['string', 'null'] },
              contact_page: { type: ['string', 'null'] },
            },
          },
          notes: { type: 'string' },
        },
        required: ['state', 'name', 'status', 'notes'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    could_check: { type: 'boolean', description: 'Did you actually open the source and read it in this session? False if it would not fetch, was blocked, or rendered empty.' },
    quote_is_in_the_source: { type: 'boolean' },
    status_follows_from_the_quote: { type: 'boolean' },
    document_belongs_to_this_district: { type: 'boolean' },
    refuted: { type: 'boolean', description: 'The finding is WRONG. Not "I could not check it" -- that is could_check false.' },
    why: { type: 'string' },
  },
  required: ['name', 'could_check', 'refuted', 'why'],
}

// args is the list of {state, districts} to work. A scheduled run stages that list and passes it
// through verbatim; there is no filesystem access inside a workflow, so it cannot be a path.
const states = args
log(`${states.length} states, ${states.reduce((a, s) => a + s.districts.length, 0)} districts, ${states.reduce((a, s) => a + s.districts.reduce((b, d) => b + d.students, 0), 0)} students struck between them`)

// Each state is leased, scanned and released independently, so a state whose lease is refused costs
// nothing but itself and the rest carry on.
const perState = await pipeline(
  states,

  // Claim. The protocol exists so two contributors do not read the same district; going around it is
  // how a whole-state Missouri lease and a per-district Missouri run ended up held at once.
  (s) => agent(
    `Claim a lease so nobody else reads these districts while we do.

Call list_leases on the crew server at ${SERVER} first, to see what is held. Then call claim_task with:
  task: "district-policy-scan"
  scope: "${s.state}"
  agent: "claude-sonnet-5 via Claude Code workflow"
  human: "${HUMAN}"

A lease now blocks any overlapping scope, so if someone holds "${s.state}" or a district inside it, you will be refused and told which lease it overlapped. If that happens do not work around it and do not pick a different scope: report claimed=false with the server's exact words. Somebody else is already doing this and duplicating them is the thing the lease is for.`,
    { label: `claim:${s.state}`, phase: 'Claim', schema: CLAIM, model: 'sonnet' }
  ),

  // Scan, in batches of four, only if the lease was granted.
  (claim, s) => {
    if (!claim || !claim.claimed) {
      log(`${s.state}: not claimed — ${claim ? claim.why_not : 'no answer'}`)
      return { state: s.state, skipped: true, why: claim ? claim.why_not : 'claim agent failed', lease_id: null, findings: [] }
    }
    const batches = []
    for (let i = 0; i < s.districts.length; i += 4) batches.push(s.districts.slice(i, i + 4))
    return parallel(batches.map((batch, i) => () => agent(
      `Read /tmp/work/BRIEF.md first and follow it exactly. It is the contract: open the primary source yourself, quote verbatim, date everything, never guess.

You are working under lease ${claim.lease_id} on scope "${s.state}".

Your districts (${s.state} batch ${i + 1} of ${batches.length}):
${JSON.stringify(batch, null, 1)}

Every one told the federal government it struck students in 2023-24 and none has ever been recorded by this project. "allows" is the expected answer and still has to be quoted from the document. A district here that now PROHIBITS it has changed policy since then, which is the most valuable finding there is: read its adoption and revision dates carefully and put them in policy_adopted and policy_revised.

Tools, on the crew server at ${SERVER}:
- fetch_tasb_policy {"district_key":"<number>"} for Texas. Code FO; FO(LOCAL) is the district's own policy, FO(LEGAL) is the statute and establishes nothing. Keys are findable without a search engine: https://pol.tasb.org/Home/Index/<key> fetches through fetch_document and prints the district name, and keys run in county-district-number order, so two probes bracket a district.
- fetch_simbli_policy {"site":"<S number>"} for Alabama, Georgia, Mississippi. In Mississippi <district>.msbapolicy.org redirects to the S number. It paces the whole fleet against the vendor's rate limit. Let it be slow and do not go around it with a browser: that is what got the whole fleet blocked once already.
- resolve_handbook and fetch_document for everything else.

Three things that cost other agents hours today:
- A 3,038-byte stub from a district site is a rate limiter, not a wall. Wait a few seconds and retry.
- Apptegy sites hide documents behind JavaScript, but their CMS answers unauthenticated at thrillshare-cmsv2.services.thrillshare.com/api/v2/s/<section>/documents, where <section> comes from a regex for api/v2/s/(\\d+)/documents over the page HTML.
- The address in the federal directory is from 2023-24 and is sometimes dead. Find the live site.

Set students_2023_24 from the input row. Capture the district's published contact while you are on its site: public record only, never a personal address or an individual who is not the published point of contact, and a null beats a guess.

A district you genuinely cannot read is status "unknown", with notes saying exactly what you tried and what the next contributor should open. That is a real contribution and it is wanted.`,
      { label: `scan:${s.state}-${i + 1}`, phase: 'Scan', schema: FINDING, model: 'sonnet' }
    ))).then(rs => ({
      state: s.state,
      lease_id: claim.lease_id,
      skipped: false,
      findings: rs.filter(Boolean).flatMap(r => r.findings || []),
    }))
  },

  // Check. A different agent, told to refute rather than confirm.
  (scanned) => {
    if (scanned.skipped || !scanned.findings.length) return scanned
    const checkable = scanned.findings.filter(f => f.status !== 'unknown' && f.source && f.quote)
    if (!checkable.length) return scanned
    // Verdicts are matched to findings BY POSITION, not by name. The first version joined on the name
    // the refuter reported, which is a model-written free-text field: it came back as "Enterprise City,
    // AL — corporal punishment policy 6.17" against a finding named "Enterprise City", the join missed,
    // and two good verified findings were dropped on the floor. parallel() preserves order; order is a
    // fact, a name echoed by a model is not.
    // Three refuters per finding, not one. Two careful refuters reached OPPOSITE verdicts on Enterprise
    // City's wording -- "must be contacted for approval prior to administering" inside a policy that
    // also allows opting out -- which is exactly the opt-in/opt-out judgment the check exists to catch.
    // One refuter is a coin flip on the hard cases, and the hard cases are the point. Kill on a
    // majority, and surface a split rather than letting whichever one ran stand as the answer.
    return parallel(checkable.map(f => () => parallel([0, 1, 2].map(k => () => agent(
      `Try to REFUTE this finding. Another agent produced it and it enters a public record if it survives you. Default to refuted=true when unsure.

${JSON.stringify({ state: f.state, name: f.name, status: f.status, source: f.source, quote: f.quote, policy_code: f.policy_code }, null, 1)}

Fetch the source yourself from the crew server at ${SERVER} — fetch_document, or fetch_tasb_policy / fetch_simbli_policy if it is one of those. Take nothing on the other agent's word.

If the source is a Simbli URL, call fetch_document on it rather than fetch_simbli_policy: the server already holds the policy text under that exact URL from when it was first read, so you get the same copy submit_finding checks against without another request to a vendor that rate-limits the whole fleet. Only fall back to fetch_simbli_policy if fetch_document has nothing. Check three things:

1. Is that exact sentence in that document? A term search returns a window around the match and a quote longer than the window gets cut in half by it, so if the windowed text does not contain the quote, search again on a distinctive phrase FROM THE QUOTE, or read the page it sits on in full. Absence from a term window is not absence from the document. A real policy was nearly thrown away today for exactly this.
2. Does the status follow? "allows" includes a policy a parent may opt OUT of. "consent_required" means advance written permission, opt IN. These are easy to inject backwards and that is the most common error here.
3. Does the document name THIS district? Not a neighbour, not a same-named district in another state, and note that a county district and a city district of the same name are two different districts with two different policies.

Two different outcomes, and keeping them apart is the whole point:
- You opened the source and one of the three checks fails: could_check=true, refuted=true. The finding is wrong.
- You could not open the source at all -- blocked, empty, dead link: could_check=FALSE, refuted=false. You are abstaining, not objecting. Say what you tried.

Do not vote to refute something you could not read. On the last run a district verified in a browser by one agent was killed by two who never loaded the page, which measured the vendor's uptime rather than the finding's truth.`,
      { label: `check${k + 1}:${f.name.slice(0, 20)}`, phase: 'Check', schema: VERDICT, model: 'sonnet' }
    ))).then(vs => {
      const got = vs.filter(Boolean)
      if (!got.length) return null
      // Only agents that actually opened the source get a vote. An agent that could not fetch it has
      // not refuted anything; it has failed to check. Counting those as votes against turns the panel
      // into a measurement of the vendor's uptime -- Monroe County was verified in a browser by one
      // agent and killed by two who never loaded the page.
      const able = got.filter(v => v.could_check)
      const against = able.filter(v => v.refuted).length
      return {
        unverifiable: able.length === 0,
        refuted: able.length > 0 && against * 2 > able.length,
        split: against > 0 && against < able.length,
        votes: able.length ? `${against} of ${able.length} who could read it refuted; ${got.length - able.length} could not check` : `none of ${got.length} could open the source`,
        why: got.map(v => `${!v.could_check ? 'ABSTAINED' : v.refuted ? 'REFUTED' : 'passed'}: ${v.why}`).join('\n\n'),
      }
    }))).then(verdicts => {
      const checks = new Map()
      checkable.forEach((f, i) => { if (verdicts[i]) checks.set(f, verdicts[i]) })
      return { ...scanned, findings: scanned.findings.map(f => (checks.has(f) ? { ...f, _check: checks.get(f) } : f)) }
    })
  },

  // Release, whatever happened above, so a crash does not sit on a scope for four hours.
  (scanned) => {
    if (!scanned.lease_id) return scanned
    return agent(
      `Call release_lease on the crew server at ${SERVER} with lease_id "${scanned.lease_id}". Reply with the word released, or with the error if it refused.`,
      { label: `release:${scanned.state}`, phase: 'Release', model: 'sonnet' }
    ).then(() => scanned)
  }
)

const done = perState.filter(Boolean)
const all = done.flatMap(s => s.findings)
const checked = all.filter(f => f._check)
const refuted = checked.filter(f => f._check.refuted)
// Three outcomes, and every finding lands in exactly one. Nothing is dropped for having no verdict:
// the first version's filter silently discarded any finding whose check did not come back, which is
// indistinguishable in the output from a finding that was never made.
const unknown = all.filter(f => f.status === 'unknown')
const passed = all.filter(f => f.status !== 'unknown' && f._check && !f._check.refuted && !f._check.unverifiable)
const unverifiable = all.filter(f => f.status !== 'unknown' && f._check && f._check.unverifiable)
const unchecked = all.filter(f => f.status !== 'unknown' && !f._check)
const survived = [...unknown, ...passed, ...unchecked.map(f => ({ ...f, _unchecked: true }))]
const skipped = done.filter(s => s.skipped)

log(`${all.length} districts read across ${done.length - skipped.length} states, ${checked.length} quotes checked, ${refuted.length} refuted, ${unverifiable.length} unverifiable, ${unchecked.length} not checked`)
if (all.length !== unknown.length + passed.length + unchecked.length + refuted.length) log(`WARNING: ${all.length} findings do not account for ${unknown.length + passed.length + unchecked.length + refuted.length}`)

return {
  states_skipped: skipped.map(s => ({ state: s.state, why: s.why })),
  districts_read: all.length,
  quotes_checked: checked.length,
  not_checked: unchecked.map(f => ({ state: f.state, name: f.name, status: f.status })),
  // Nobody could open the source. These are not wrong, they are unread, and they are worth retrying
  // rather than rejecting.
  unverifiable: unverifiable.map(f => ({ state: f.state, name: f.name, status: f.status, source: f.source, votes: f._check.votes })),
  refuted: refuted.map(f => ({ state: f.state, name: f.name, votes: f._check.votes, why: f._check.why })),
  // Findings the refuters disagreed about. These survived on a majority and are the ones worth a human
  // reading, because a split is the panel telling you the call is genuinely hard.
  split_verdicts: survived.filter(f => f._check && f._check.split).map(f => ({ state: f.state, name: f.name, status: f.status, votes: f._check.votes, why: f._check.why })),
  prohibits_now: survived.filter(f => f.status === 'bans').map(f => ({ state: f.state, name: f.name, students: f.students_2023_24, adopted: f.policy_adopted, revised: f.policy_revised })),
  by_status: survived.reduce((a, f) => ({ ...a, [f.status]: (a[f.status] || 0) + 1 }), {}),
  findings: survived,
}
