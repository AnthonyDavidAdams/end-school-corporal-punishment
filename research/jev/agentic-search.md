# Agentic web search without frontier tool calls

**Measured 2026-09-24 on this project's own crawl: $0.40 where a frontier agent would spend $69 to $346.**

## The shape

A browsing agent today reads a page into its context and decides what to do next. Every decision —
which link, is this the right document, is this the district's own site — costs a full inference pass
over the whole page at frontier prices. The page is the input; the decision is a few tokens of output.
Nearly all of what is paid for is reading.

Invert it. Fetch and parse deterministically, and send the model **only the decision**, as options:

```
1. search / fetch          deterministic, free
2. extract candidates      every link as (anchor text, url) -- deterministic
3. score all of them       one calibrated question per candidate, ALL in one request
4. follow everything above the bar
5. escalate to a frontier model only where the score is low
```

The page never reaches the model. Its links do.

## What it cost here

| | |
|---|---|
| 169 district sites walked, **847 pages**, every link on each scored | **$0.3830** |
| 196 search result sets ranked to recover dead addresses | **$0.0208** |
| **total** | **$0.4038** |

The same 847 pages, priced on input alone against what a browsing agent would have to read — measured
average district home page is 108,910 bytes, about 27,228 tokens:

| model | per page | 847 pages |
|---|---|---|
| Haiku 4.5 | $0.0272 | **$23.06** |
| Sonnet | $0.0817 | **$69.19** |
| Opus | $0.4084 | **$345.93** |

That is input only. No output tokens, no reasoning tokens, no retries, and one pass per page rather
than the several a real agent takes. The true gap is wider.

## Why it is ~180x and not ~10x

Two multiplications, not one.

**Less text.** A page's links are a small fraction of its bytes. 108,910 bytes of HTML becomes roughly
113 links at about 130 tokens each — and only the links bear on "where do I go next".

**Cheaper text.** A decision model prices input at $0.042/MTok against $3 to $15. Output is free
because there is barely any: a probability per option.

About 2x less text times about 70x cheaper text. The observed 181x against Sonnet sits where that
predicts.

## What makes it work rather than merely cheap

**The options are ours.** The model selects among strings we extracted, so it cannot invent a URL, and
in the classification step it cannot invent a quote. That is a structural guarantee, not a prompt
instruction — and it is why this suits a public record whose whole value is verbatim sourcing.

**It can decline.** Every ranking carries "none of these", and every score is a calibrated probability
rather than a rank. Searching for Crossett School District returns U.S. News first and the district
second; a ranker that must pick something picks U.S. News.

**It says when it does not know.** Low confidence routes to a person or a frontier model instead of
into the record. Those escalations were about one district in twenty here.

## What it does not replace

Discovery judgement on a hostile site, reading a document properly, writing anything. A frontier agent
is still the right tool where the work is genuinely open-ended. This replaces the part of browsing that
is *choosing among things you already found*, which turns out to be most of the tokens.

## Reproduce

```sh
node tools/tasb/find-live-site.mjs   --in data/handbooks/stale.json   # search, then rank
node tools/tasb/harvest-site.mjs     --in data/handbooks/live.json    # walk, scoring every link
```

Cost figures come from the `cost` field each run records per district, summed over
`data/handbooks/site-harvest.jsonl` and `data/handbooks/sites.jsonl`. Page sizes were measured by
fetching twelve of the districts walked.
