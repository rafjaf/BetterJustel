const JUSTEL_RESULTS_URL = "https://www.ejustice.just.fgov.be/cgi_loi/rech_res.pl";

export function parseJustelQuery(value) {
	const raw = value.trim();
	for (const match of raw.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
		const [year, month, day] = match[0].split("-").map(Number);
		const parsed = new Date(Date.UTC(year, month - 1, day));
		if (parsed.getUTCFullYear() !== year
			|| parsed.getUTCMonth() !== month - 1
			|| parsed.getUTCDate() !== day) {
			continue;
		}
		return {
			title: `${raw.slice(0, match.index)} ${raw.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim(),
			date: match[0],
		};
	}
	return {title: raw, date: ""};
}

export function buildJustelSearchUrl(value, nature = "") {
	const query = parseJustelQuery(value);
	const params = new URLSearchParams({
		language: "fr",
		text1: query.title,
		chercher: "c",
		trier: "promulgation",
		fr: "f",
	});
	if (query.date) {
		params.set("ddd", query.date);
		params.set("ddf", query.date);
	}
	if (nature) {
		params.set("dt", nature);
	}
	return `${JUSTEL_RESULTS_URL}?${params}`;
}
