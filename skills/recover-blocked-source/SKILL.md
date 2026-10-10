---
name: recover-blocked-source
description: For a district whose policy the crew server cannot read (a JavaScript-only policy portal, a bot challenge, a scanned PDF, a .doc or .docx the extractor refuses), open it yourself, quote the policy verbatim, and resubmit with source_text attached so a reviewer can confirm it. Use when handed the recover-blocked-source task, or when submit_finding refuses a quote because the server could not read the source.
---

# Recover a blocked source

Argument: one district ("<District name>, <XX>") from the task's scopes, or one vendor's districts.

The output is a district record whose policy text is attached verbatim as `source_text`, with the page or section it came from, plus anything learned about the vendor added to `crew/notes/blocked-sites.md`.

## Steps

1. `claim_task` with task `recover-blocked-source`, your `agent` and `human`. Renew before `expires_at`; release when you stop.
2. Read the stored record and `crew/notes/blocked-sites.md`, along with any vendor note beside it in `crew/notes/`. Check `list_pending` for each district task (`district-policy-scan`, `contact-capture`, `date-the-change`, `recover-blocked-source`) and carry forward what a pending finding has.
3. Confirm the district's own website: domain, name and address in this state. Find where its policy or handbook is published (`resolve_handbook`).
4. Try the shared tools first, and record each attempt for `notes`: `fetch_document`, `fetch_simbli_policy`, `fetch_tasb_policy`. Then check your tool list for the vendor readers proposed in PR #38 (fetch_boarddocs_policy, fetch_diligent_policy, fetch_forethought_policy, fetch_kasb_policy, fetch_tsba_policy, fetch_boardpolicyonline_policy). They may not be deployed yet. If one is listed, use it and cite the URL it returns.
5. If no tool reads the policy, read it yourself with the methods below. Pace your requests. Never use a login, and never get past a page that asks for one.
6. Find the sentence that settles the status, and classify it per `AGENTS.md`.
7. Copy into `source_text` the policy text as you read it: the heading, the policy code, any dates line, and the passage containing the quote. Keep it verbatim, at least 40 characters. Do not tidy it, translate it, or fill gaps. If it was OCR'd, say so in `notes`.
8. `submit_finding` with task `recover-blocked-source`, the complete record, `source_text`, and `skill` set to `recover-blocked-source@0.1`. The finding is flagged as agent-supplied and always goes to a person.
9. Add what you learned about the vendor to `crew/notes/blocked-sites.md` in a small pull request. If you cannot open one, `report_issue` with kind `feature`, giving the method and one working example.

## Methods that worked

- **BoardDocs.** GET the district's `Board.nsf/Public` page with a browser User-Agent, then POST to `Board.nsf/BD-GetPolicies` (`status=active&book=Policy Manual`) for the policy list. POST `Board.nsf/BD-GetPolicyItem` (`id=<id>`) for the text and its Status / Last Revised header. `Board.nsf/SEARCH` takes `searchstring`, `meetings`, `minutes`, `policies` and `attachments`. `BD-GetPublicFiles`, `BD-GetAgendaItem` and `BD-GetMeetingsList` work on some sites. Plain HTTP works; headless browsers get 403. The state part of the path is not always the postal code: some Florida sites use `fla`.
- **Diligent Community.** Use the public API on the district's host: `/api/policies/policyPublicList`, then `/api/policy/<id>/PublicPolicyDetail`, then `/document/<id>/` (issue_1c2b8dd6df96).
- **Forethought.** Policies at `app.forethoughtconsulting.com/kb/<slug>` load through the page's Next.js server action `getKnowledgeBaseDocuments`, called with an Origin header (issue_630b5594f4a1). Sites whose links use a uuid on another subdomain do not work this way.
- **KASB (Kansas).** Send a plain request with no User-Agent to `https://policy.kasb.org/sopapi/document/getdocument/kansas/<ShowSet>/<Collection>/<sopCode>`. The table of contents is at `/sopapi/toc/getshowset/kansas/<ShowSet>`. The JSON may be double-encoded; its `html` field has the text and the board's "Approved:" dates. Ignore the "KASB Recommendation" footer. Take the ShowSet from the district's own policy link; it cannot be guessed (issue_7f869a85db76).
- **TSBA (Tennessee).** Manuals are shared through SharePoint guest links. Policy 6.314 carries an "Issued Date". The download method is in issue_a0582c51f3ea.
- **BoardPolicyOnline (NC, SC).** The v3 site is a Blazor app with no JSON API, and the legacy host resets the connection. A page renderer has read it where a plain fetch cannot (issue_c5c3f64aa231). Some hosts answer a plain request with no User-Agent when a browser User-Agent is refused.
- **Apptegy / Thrillshare.** The page text is escaped JSON inside the HTML that a plain request returns, so search the raw HTML. Document lists come from the CMS API in `blocked-sites.md`, with `?locale=en&folder_id=<id>`.
- **Simbli behind Incapsula.** Slow down; do not retry in a loop. `fetch_simbli_policy` paces the whole fleet. Reading Simbli in bulk from your own address has caused fleet-wide blocks.
- **Cloudflare blocks everything.** A Wayback Machine capture is acceptable. Cite the capture URL as `source`, set `archived_url`, and give the capture date in `notes`. Say the live page could not be read.
- **Scanned PDF, .doc, .docx.** `fetch_document` returns `needs_ocr` for a scan, and refuses `.doc` (issue_f7e02c983d7a). Extract the text locally (OCR or a Word text extractor), check it against the page image, and attach it.
- **Text proxies** such as `r.jina.ai` find a document's URL only. They are never the `source`, and only public policy documents may be routed through them.

## The record

Shape: `crew/schemas/district-finding.schema.json`. It requires `state`, `name`, `status` and `last_verified`, plus `source` and `quote` for a non-`unknown` status. `source` is the document's own URL, not a proxy and not an API endpoint a person cannot open. Carry forward `name` and `nces_id` exactly as stored, plus `county`, `policy_code`, the policy dates and the `contact` block (required in AL, AR, FL, GA, MO, MS, OK, TN and TX). In `notes`, say which wall it was, what the shared tools returned, the method that worked, and the page or section the text came from.

## Done means

- The policy text is attached verbatim, with the page or section it came from.
- Notes say which wall it was and what was tried through the shared tools first.
- Anything learned about the vendor is added to `crew/notes/blocked-sites.md`.

## Pitfalls

- **A force or restraint sentence is not a ban.** "Reasonable force to restrain a student" says nothing about paddling.
- **A pre-K-only sentence does not settle a K-12 district.** Many districts prohibit it in pre-K or Head Start only.
- **A ban for students with disabilities only**, with corporal punishment allowed otherwise, is `allows`.
- **Consent wording plus an opt-out sentence** is ambiguous. `consent_required` needs written permission obtained in advance; a parent's right to refuse is `allows`. File the status that the operative sentence supports, quote both sentences in `notes`, and ask the reviewer to decide.
- A handbook silent on corporal punishment is not `bans` unless state law prohibits it.
- **Same-named districts in other states** account for many wrong records. Check the state, domain and address of whatever you recover before trusting it.
- If you still cannot read the policy, do not file `unknown` or "found nothing". `report_issue` with the wall and every attempt (check `list_issues` first).
- **A new finding supersedes the pending finding for the same district.** File complete records.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. When working in the repository, use a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Through the crew server: `release_lease`, and report each district filed, each still blocked with its issue id, and any change to the notes file.
2. In the repository: run `cd tools && npm i && npm run validate`, commit only the files you changed, by name, and open a pull request with `gh pr create`, including the agent disclosure line naming this skill and its version.
