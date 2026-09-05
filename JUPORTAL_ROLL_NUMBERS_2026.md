# Juportal: new Court of Cassation roll numbers since June 2026

This note records observations made on 5 September 2026 about the Belgian Court
of Cassation data published through Juportal. It is intended for reuse by other
applications that collect or analyse the Court's judgments.

## Summary

Since June 2026, some judgments use a roll number in this form:

```text
26/CAS/0418
```

This format coexists with legacy roll numbers such as:

```text
P.26.0036.N
C.25.0065.N
S.22.0045.N
F.22.0145.N
D.24.0005.N
```

Applications must therefore support both systems. They must not infer the
matter of a `YY/CAS/NNNN` case from its roll number: unlike the initial letter
of a legacy number, `CAS` is not a civil, criminal, social, tax, or disciplinary
matter code. It also does not give any information on the language of the case.

The first record found through the RSS publication-date search was published on
15 June 2026. The Juportal XML sitemaps used by `juportal_crawler` also contain
an earlier record, `26/CAS/0004`, in the 10 June 2026 sitemap. Sitemap consumers
should therefore start a completeness backfill no later than 10 June 2026.

## Confirmed format and examples

The new format observed in Juportal is:

```text
YY/CAS/NNNN
```

- `YY` is a two-digit year.
- `CAS` is a literal, case-insensitive token when parsing input.
- `NNNN` is a four-digit sequence in all records observed as of 5 September
  2026. Parsers may choose to allow more digits defensively, but should retain
  the exact value published by Juportal.
- The number contains no language suffix and no usable matter prefix.

Confirmed mappings include:

| Judgment date | Roll number | ECLI |
| --- | --- | --- |
| 23 June 2026 | `26/CAS/0006` | [`ECLI:BE:CASS:2026:ARR.20260623.2N.13`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260623.2N.13/NL) |
| 22 July 2026 | `26/CAS/0091` | [`ECLI:BE:CASS:2026:ARR.20260722.VAC.4`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260722.VAC.4/FR) |
| 28 July 2026 | `26/CAS/0290` | [`ECLI:BE:CASS:2026:ARR.20260728.VAC.12`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260728.VAC.12/FR) |
| 4 August 2026 | `26/CAS/0413` | [`ECLI:BE:CASS:2026:ARR.20260804.VAC.4`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260804.VAC.4/FR) |
| 4 August 2026 | `26/CAS/0418` | [`ECLI:BE:CASS:2026:ARR.20260804.VAC.3`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260804.VAC.3/FR) |
| 11 August 2026 | `26/CAS/0264` | [`ECLI:BE:CASS:2026:ARR.20260811.VAC.3`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260811.VAC.3/FR) |
| 18 August 2026 | `26/CAS/0495` | [`ECLI:BE:CASS:2026:ARR.20260818.VAK.2`](https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260818.VAK.2/NL) |

In particular, `26/CAS/0418` belongs to the judgment of 4 August 2026. The
judgment of 23 June 2026 has roll number `26/CAS/0006`.

### ECLI replacement observed for `26/CAS/0264`

Juportal's 14 August sitemap identifies `26/CAS/0264` as
`ECLI:BE:CASS:2026:ARR.20260811.2F.3`. The current content page identifies the
same judgment as `ECLI:BE:CASS:2026:ARR.20260811.VAC.3` and displays the former
value under `Remplace le numéro`. Requests made with either identifier currently
resolve to the canonical `VAC.3` page.

Consequently, an ECLI published in a sitemap can later become a replaced alias.
Applications should retain both the source ECLI and any replacement relationship
published by Juportal. The current `juportal_crawler` output still uses the ECLI
found in the sitemap, so it exposes this judgment under the older `2F.3` value.

## Juportal RSS representation

The Court's RSS search feed places the roll number in the first bold element of
the HTML `description`. For example:

```html
<p><bold>Cour de cassation - 04 août 2026 - 26/CAS/0418</bold></p>
```

The feed has been observed using both the non-standard `<bold>` element and the
standard `<b>` element, so collectors should accept both. A suitable strict
pattern for the currently observed new format is:

```regex
\b\d{2}/CAS/\d{4}\b
```

A combined JavaScript pattern supporting the new format and the legacy format
used by Cassnews is:

```js
/\b(\d{2}\/CAS\/\d{4}|[A-Z]\.(?:\d{2}|\d{4})\.\d{4,5}\.[A-ZNF](?:-[A-Z]\.(?:\d{2}|\d{4})\.\d{4,5}\.[A-ZNF])?)\b/i
```

Do not filter an RSS entry by `rollNumber.charAt(0)`: this causes every new
number to be treated as type `2` and normally discarded.

## Classification consequences

Legacy roll numbers expose a matter code in their first character:

| Prefix | Matter |
| --- | --- |
| `C` | Civil |
| `P` | Criminal |
| `S` | Social |
| `F` | Tax |
| `D` | Disciplinary |

The new `CAS` format does not provide an equivalent code. Although the first
records observed happened to concern criminal law, that must not be generalized:
future `CAS` numbers may concern any matter.

Recommended data model:

```json
{
  "rollNumber": "26/CAS/0418",
  "rollNumberSystem": "CAS",
  "matterFromRollNumber": null
}
```

If an application needs a grouping key for compatibility with an existing
C/P/S/F/D pipeline, use a neutral value such as `CAS` or `unclassified`. Do not
map it to `P`. Matter information obtained independently from Juportal metadata,
the judgment text, or a classifier should be stored separately and should record
its provenance.

## Stable identity and deduplication

Use the full roll number as the storage key if that is the application's existing
practice. Preserve slashes and leading zeroes; for example, do not turn `0418`
into `418`.

For stronger cross-system deduplication, retain the ECLI separately from the roll
number. The ECLI remains present in the RSS `title`, `guid`, and link even when
the roll-number format changes. However, the `26/CAS/0264` replacement described
above shows that an ECLI must not be treated as immutable in isolation. Store a
canonical ECLI plus replaced/alias ECLIs when Juportal supplies that information.
Do not attempt to derive the roll number from the ECLI: the two sequences are
unrelated.

Language variants may share the same ECLI and roll number while having different
`/FR` or `/NL` Juportal URLs. Merge those variants under the same judgment and
retain language-specific URLs and texts.

## `juportal_crawler` implementation and exposed data

The `juportal_crawler` application uses Juportal's XML sitemap feed, not its RSS
search feed. Its implementation was updated on 5 September 2026 as follows:

- role-number references are accepted with either the French `Numéro de rôle`
  or Dutch `Rolnummer` label, with or without a colon;
- both legacy numbers and case-insensitive `YY/CAS/NNNN` numbers are recognized;
- more than four sequence digits are accepted defensively, while the exact
  published string, including leading zeroes, is retained;
- the historical field name `roleNumber` remains in place for compatibility;
- `rollNumberSystem` is `CAS`, `legacy`, `unknown`, or `null`;
- `matterFromRollNumber` is populated from a valid legacy C/P/S/F/D prefix and
  is always `null` for a `CAS` number;
- `judgementUrls`, `abstractFR`, and `abstractNL` are merged rather than
  overwritten when the same ECLI and article are encountered again; and
- regression fixtures cover both a legacy sitemap and a bilingual CAS sitemap.

A normal exported record under `data/*.json` now has this shape:

```json
{
  "court": "CASS",
  "date": "2026-08-04",
  "roleNumber": "26/CAS/0418",
  "rollNumberSystem": "CAS",
  "matterFromRollNumber": null,
  "judgementUrls": [
    "https://juportal.be/content/ECLI:BE:CASS:2026:ARR.20260804.VAC.3/FR"
  ],
  "sitemap": ["https://juportal.just.fgov.be/JUPORTAsitemap/..."],
  "abstractFR": ["..."],
  "abstractNL": null
}
```

The ECLI is not repeated inside this object: it is the enclosing object key in
the article-indexed data file. Downstream applications must read that key as the
source ECLI.

### Judgments without legal bases

`juportal_crawler` only writes a judgment to `data/*.json` when the sitemap
supplies at least one legal basis that can be associated with an ELI. A detected
judgment with no legal bases is instead recorded in `no_legal_basis.json` with
`ecli`, `roleNumber`, `rollNumberSystem`, `matterFromRollNumber`, `url`, and
`urls`. It is not present in the normal article-indexed export.

This distinction matters for downstream consumers: absence from `data/*.json`
does not mean that the crawler failed to recognize the judgment. Consumers that
need a complete judgment inventory must also ingest `no_legal_basis.json` (and,
where relevant, `missing_eli.json`) or the crawler must expose a consolidated
judgment-level index.

### Sitemap backfill command and observed result

The crawler now provides:

```bash
node index.js --backfill-cas \
  --from 2026-06-10 \
  --to 2026-09-05
```

The date bounds select sitemap index dates. In Juportal sitemap metadata this is
the publication/`issued` date, which can be later than the judgment date. The
command filters for `rollNumberSystem === "CAS"` before downloading a judgment
page, merges records by ECLI, and deliberately leaves the normal crawl
checkpoints in `settings.json` unchanged.

A run on 5 September 2026 with the default start date of 15 June detected these
five CAS judgments in the sitemap feed:

| Roll number | ECLI exposed by `juportal_crawler` | Result |
| --- | --- | --- |
| `26/CAS/0006` | `ECLI:BE:CASS:2026:ARR.20260623.2N.13` | `no_legal_basis.json` |
| `26/CAS/0091` | `ECLI:BE:CASS:2026:ARR.20260722.VAC.4` | `no_legal_basis.json` |
| `26/CAS/0264` | `ECLI:BE:CASS:2026:ARR.20260811.2F.3` | `no_legal_basis.json`; ECLI later replaced by `VAC.3` |
| `26/CAS/0290` | `ECLI:BE:CASS:2026:ARR.20260728.VAC.12` | `no_legal_basis.json` |
| `26/CAS/0495` | `ECLI:BE:CASS:2026:ARR.20260818.VAK.2` | `no_legal_basis.json` |

The crawler also already contained `26/CAS/0004` from the 10 June sitemap, which
was outside that run's date range. Until the crawler's default is changed, use an
explicit `--from 2026-06-10` to include it. None of the five in-range judgments
contained legal bases, so the command ended with:

```text
CAS backfill complete — judgments saved or merged: 0
```

That message counts only judgments exported to `data/*.json`; it is not a count
of CAS judgments detected. Until the command reports separate detected,
exported, and no-legal-basis totals, its final number must not be used for
completeness monitoring.

The RSS search found `26/CAS/0413` and `26/CAS/0418`, but they were absent from
the sitemap-based crawler output after the backfill. At the time of inspection,
Juportal's `robots.txt` listed sitemap indexes only through 4 September 2026,
whereas the RSS observations were made on 5 September. This demonstrates that
RSS/search and sitemap availability can lag one another. A downstream system
requiring same-day completeness should ingest both sources or retry the sitemap
backfill after later sitemap publication.

## Backfilling records missed by an old parser

An application that rejected unknown matter prefixes should re-query Juportal
through the current date using its normal publication-date search. RSS-based
consumers should start by 15 June 2026; sitemap-based consumers should start by
10 June 2026 because of the additional `26/CAS/0004` sitemap record. They should
then retain entries whose extracted roll number matches the new format.

For Cassnews, the targeted command used on 5 September 2026 is:

```bash
node cassnews.js \
  --from 2026-06-15 \
  --to 2026-09-05 \
  --date-type publication \
  --types CAS
```

Replace the end date with the actual catch-up date. The `CAS` filter prevents
legacy judgments in the same date range from being included. Add `--parse` if
abstract extraction is required, and add `--mail` only if a one-off catch-up
newsletter should be sent.

As of 5 September 2026, this publication-date query found the seven `CAS`
judgments listed above. That count is a historical observation, not a permanent
property of the feed: Juportal can publish additional or translated material
later.

## Implementation checklist

- Accept both legacy roll numbers and `YY/CAS/NNNN`.
- Search `<b>` and `<bold>` in RSS description HTML.
- Preserve the complete roll number, including slashes and leading zeroes.
- Do not derive matter from a `CAS` number.
- Provide an unclassified bucket rather than dropping the judgment.
- Stop deriving display styles or output categories from the first character of
  the roll number.
- Keep ECLI, roll number, language, and matter as separate fields.
- Preserve replaced ECLIs as aliases instead of assuming every published ECLI is
  immutable.
- Merge FR and NL variants without overwriting the other language.
- Backfill RSS from 15 June 2026 and sitemaps from 10 June 2026 using publication
  date.
- Count detected, exported, missing-ELI, and no-legal-basis judgments separately.
- If consuming `juportal_crawler`, include `no_legal_basis.json` when a complete
  judgment inventory is required.
- Add regression fixtures for both numbering systems.

## Scope and review date

These findings are based on the live Juportal pages, RSS results, XML sitemaps,
and a `juportal_crawler` backfill inspected on 5 September 2026. Because the new
system was still coexisting with the legacy system, consumers should monitor
later records for changes in digit length, additional tokens, ECLI replacements,
source-specific publication lag, or official documentation clarifying the
meaning of `CAS`.
