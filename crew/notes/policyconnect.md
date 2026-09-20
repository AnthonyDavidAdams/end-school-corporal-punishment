# PolicyConnect (policyconnect.org)

Texas districts are leaving TASB Policy Online for PolicyConnect. Found by a contributor's agent
scanning Sherman ISD, which had left TASB entirely; Midland ISD (TASB key 886) is the same case.
Both are currently recorded as `unknown` for that reason.

It is a Nuxt (Vue) single-page app: a plain fetch of `/org/<orgCode>` returns a 24 KB shell with no
policy text, the same shape TASB and Simbli had before their readers existed.

## What is known

API base `https://policyconnect.org/api/v1`. No authentication for any of these.

| Step | Endpoint | Gives |
|---|---|---|
| org | `GET /user/getMyOrg/<orgCode>` | the org, with `data.id` (a Mongo ObjectId). `orgCode` is the slug from the district's own link, e.g. `sherman-isd` |
| sections | `GET /subSection/getSectionOrSubsectionByOrg/<orgId>?filter[name]=` | 7 top sections, A–G. Section F is Students |
| subsections | `GET /subSection/getSubSection-by-sectionId/<sectionId>` | 68 entries for Sherman, each with `name`, `code` and `policies: [{policyId, policyType}]` |

The coding matches TASB: Sherman's "Student Discipline" is code **FO**, and each subsection carries
both a Local Policy and a Legal Reference policy id. Policy types are identified by their own ids —
`659690121db25d07a8d17e34` is Local Policy, `65968ff31db25d07a8d17e32` is Legal Reference.

## What is missing

The endpoint that returns a policy's text. `GET /policy/getPolicyById/<policyId>` exists but answers
401, and the public site clearly renders policy text without a login, so there is a public route this
has not found. Guessing has been tried and did not converge; the remaining step is to open a policy
in a browser with the network panel recording and read the request off it. Everything else above was
found exactly that way.

### Tried again 2026-09-20, no progress

- `GET /user/getMyOrg/sherman-isd` still answers 200 with the org and `data.id`
  `66d126d19b7bf6ccb68f9dac`, so the entry point is stable and unauthenticated.
- `GET /subSection/getSectionOrSubsectionByOrg/66d126d19b7bf6ccb68f9dac` now answers
  `{"code":400,"status":false,"data":"Unable to getting subSection"}` without the
  `?filter[name]=` parameter. Whatever the table above was run with, the bare path is not it; try the
  filter parameter and any others the browser sends before concluding the endpoint changed.
- The eleven Nuxt chunks the page loads total 147 KB and contain no literal `api/v1` string and no
  literal path that looks like a route. The URLs are assembled at runtime, so grepping the bundle for
  endpoints does not work here even though it usually does.

This is now the second session to try to guess the content route and fail. It needs one browser
observation with the network panel open, not another round of probing; stop spending time on it
until someone can do that.

`data.id` is `id`, not `_id`, on the org response — the subsection documents use `_id`. Passing the
slug where an ObjectId is expected returns a 500 whose body names the model, which is how the shape
was confirmed.

## Access

`robots.txt` carries the Cloudflare content-signals preamble but declares no signals and no
`Disallow`, so by its own rule (c) nothing is granted or restricted. Reading a district's published
policy in order to quote and cite it is the intended public use of the site; this is not training
data. Pace requests as `fetch_simbli_policy` does.
