# What actually reaches a school district

Measured on 2026-09-19 against the districts already in the record, not assumed.

## Email: mostly does not exist

Twelve Alabama districts were fetched at the website the federal LEA directory gives for them. Every
homepage came back as real HTML — 78 KB to 108 KB, no bot challenge, no JavaScript wall. Not one of
them published an email address of any kind. Following the homepages' own contact, directory and
superintendent links found the same thing: Butler County's staff phone directory lists phones and no
addresses, Blount County's superintendent page lists none, and the only `mailto:` links found anywhere
in the sample belonged to three named staff on a single AmeriCorps program page.

Districts publish a phone, an address and a web contact form. `info@` and `superintendent@` are not
what school districts use. Two state education agency directories were checked for a bulk file with
addresses in it (Texas AskTED, Mississippi MDE) and neither served one.

So the plan of assembling 800 emails and sending them does not have a list to send to, and the paths
that would manufacture one are all bad:

- **Guessing `info@<district domain>`** puts a fabricated address in a public record and bounces.
- **Scraping named staff** turns a policy record into a contact list of individuals. The published
  address of a curriculum coordinator is not an invitation to be written to about board policy, and
  using it that way is the thing that ends a campaign.
- **Filling in web contact forms at scale** is a form submission on someone else's site, hundreds of
  times, from a script. That is spam whatever the content says.

## Post: exists for every district, verified, and gets read

The federal LEA directory gives a current mailing address for every open district in the country —
142 of the districts already scanned here, and all 832 in the federal count. It is the address the
district filed with the Department of Education, which makes it both accurate and citable.

A one-page letter to the superintendent's office, carrying the district's own board policy quoted back
to it and its own number of students struck from its own federal filing, is deliverable to all of
them, is opened by a human, and costs about a dollar. Print-and-mail APIs do this from a script.

`tools/outreach/assemble.mjs` builds the content either way; only the envelope differs.

## What the scan is collecting

Contributors scanning a district are asked for its published contact, and some districts do publish a
board clerk or superintendent's office address. Where one exists, it is recorded as
`contact.district_email` and email is the cheaper channel for that district. The point is that it is
found, per district, on the district's own page — not generated.
