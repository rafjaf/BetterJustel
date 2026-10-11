window.BJ = window.BJ || {};

// Justel dates are calendar dates. Keep them as ISO strings, without timezone conversion.
BJ.historyDate = function(text) {
	const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (iso) { return iso[0]; }
	const numeric = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
	if (numeric) { return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`; }
	const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
	const words = text.toLowerCase().match(/\b(\d{1,2})(?:er)?\s+([\p{L}]+)\s+(\d{4})/u);
	const month = words && months.indexOf(words[2]);
	return words && month >= 0 ? `${words[3]}-${String(month + 1).padStart(2, "0")}-${words[1].padStart(2, "0")}` : null;
};

BJ.historyURL = function(href, base) {
	try {
		const url = new URL(href, new URL("/cgi_loi/", base));
		return url.origin === "https://www.ejustice.just.fgov.be" && /^\/cgi_[^/]+\/article\.pl$/.test(url.pathname)
			&& /^\d+$/.test(url.searchParams.get("arch") || "") ? url.href : null;
	} catch (_) { return null; }
};

BJ.historyMetadata = function(doc, base) {
	const header = doc.querySelector("#list-title-1");
	const force = Array.from(header?.querySelectorAll("p") || []).find(p => /Entrée en vigueur\s*:/i.test(p.textContent));
	const archiveURL = Array.from(header?.querySelectorAll("a[href]") || [])
		.map(a => BJ.historyURL(a.getAttribute("href"), base)).find(Boolean);
	return {entryIntoForce: force ? BJ.historyDate(force.textContent) : null, archiveURL: archiveURL || null};
};

BJ.historyArticleNumber = function(text) {
	return text.match(/^\s*Art(?:\.|icle)\s*([A-Z]*\.?\d+\w*(?:[./:\-]\d+\w*)*|[IVXL]+)\./i)?.[1].toLowerCase();
};

BJ.historyArticleReferences = function(html) {
	const template = document.createElement("template");
	template.innerHTML = html;
	return Array.from(template.content.textContent.matchAll(/<[^<>]*\b(?:L|AR|AG|D|DCG|ORD|DRW|DGV|ACF)\s+\d{4}-\d{2}-\d{2}\/\d+[^<>]*>/gi), m => m[0]);
};

BJ.historyArticleDates = function(html) {
	return BJ.historyArticleReferences(html).map(reference => {
		const explicit = reference.match(/En vigueur\s*:\s*(\d{2}-\d{2}-\d{4})/i);
		// Before numbered footnotes, Justel put an ISO or day-first date at the
		// end of the inline amendment reference, without an "En vigueur" label.
		const legacy = reference.match(/[;,]\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s*>$/);
		return explicit ? BJ.historyDate(explicit[1]) : legacy ? BJ.historyDate(legacy[1]) : null;
	}).filter(Boolean).sort();
};

BJ.historyMatchesArticle = function(list, number) {
	return list.split(/\*{2,}|;/).some(part => {
		const token = part.trim().replace(/^Art(?:icles?)?\.?\s*(?:modifi[ée]s?\s*)?/i, "")
			.match(/^([A-Z]*\.?\d+\w*(?:[./:]\d+\w*)*|[IVXL]+)(?:\s*(?:-|à)\s*(\d+))?/i);
		if (!token) { return false; }
		if (token[2] && /^\d+$/.test(token[1]) && /^\d+$/.test(number)) {
			return Number(number) >= Number(token[1]) && Number(number) <= Number(token[2]);
		}
		return token[1].toLowerCase() === number;
	});
};

BJ.historyRecords = function(doc, base) {
	const section = Array.from(doc.querySelectorAll("h2")).find(h => h.textContent.trim() === "Fiche des modifications")?.parentElement;
	if (!section) { throw new Error("The archive modification sheet was not found"); }
	const records = [];
	for (const p of section.querySelectorAll("p")) {
		const link = Array.from(p.querySelectorAll("a[href]")).map(a => BJ.historyURL(a.getAttribute("href"), base)).find(Boolean);
		const above = p.querySelector('a[href="#page"]');
		const url = link || (above ? base : null);
		if (!url) { continue; }
		const clone = p.cloneNode(true);
		clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
		clone.querySelectorAll("a").forEach(a => a.before("\n"));
		const text = clone.textContent.replace(/\u00a0/g, " ");
		const groups = [];
		const re = /Art(?:icles?)?\.?\s*(?:modifi[ée]s?\s*)?(.+?)En vigueur jusqu['’]au\s*([^\n]+)/gis;
		for (const match of text.matchAll(re)) {
			groups.push({articles: match[1].trim(), date: BJ.historyDate(match[2])});
		}
		const lawDate = BJ.historyDate(text.match(/Modifié par.+?\bdu\s+(\d{2}-\d{2}-\d{4})/is)?.[1] || "");
		if (groups.length) { records.push({url, number: Number(new URL(url).searchParams.get("arch")), lawDate, groups}); }
	}
	if (!records.length) { throw new Error("No archive references were found in the modification sheet"); }
	return records;
};

BJ.historyModule = function(ctx) {
	const pages = new Map();
	const states = [];
	let generation = 0;
	let indexPromise;
	const schema = 1;

	function parsePage(html, url) {
		const doc = new DOMParser().parseFromString(html, "text/html");
		if (!doc.querySelector("#list-title-3 a[name]")) { throw new Error("Justel did not return an archive text"); }
		// Resolve links before the shared parser reads outerHTML from the detached DOM.
		for (const a of doc.querySelectorAll("a[href]")) {
			const href = a.getAttribute("href");
			if (!href.startsWith("#")) { a.href = new URL(href, url).href; }
		}
		const archiveCtx = {
			act: {content: []}, HEADINGS_TYPE: ctx.HEADINGS_TYPE,
			headingsWhoseTypeNeedsToBeDefined: [], addLoading() {}
		};
		const records = BJ.historyRecords(doc, url);
		BJ.analyseModule(archiveCtx).analyseContent(doc);
		const articles = new Map();
		function visit(nodes) {
			for (const node of nodes) {
				const number = BJ.historyArticleNumber(node.text);
				if (node.type === "article" && number) { articles.set(number, node); }
				if (node.children) { visit(node.children); }
			}
		}
		visit(archiveCtx.act.content);
		return {articles, records, url};
	}

	async function downloadPage(url, isIndex = false) {
		const number = new URL(url).searchParams.get("arch");
		// Store each full snapshot once, including the page used as the index.
		// Its update stamp refreshes the modification sheet even if a correction
		// keeps the archive count; older snapshots remain reusable by number.
		const key = "archive-" + ctx.act.eli + ":" + number;
		const memoryKey = key + (isIndex ? `:index:${ctx.act.lastUpdate}` : "");
		if (pages.has(memoryKey)) { return pages.get(memoryKey); }
		const started = generation;
		const task = (async () => {
			const stored = await ctx.getStorage(key);
			if (stored?.schema === schema && stored.html && (!isIndex || stored.indexUpdate === ctx.act.lastUpdate)) {
				return parsePage(stored.html, url);
			}
			const response = await fetch(url, {credentials: "omit", signal: AbortSignal.timeout(45000)});
			if (!response.ok) { throw new Error(`Justel returned HTTP ${response.status}`); }
			// Justel serves legacy Windows-1252/Latin-1 pages as well as UTF-8.
			const bytes = await response.arrayBuffer();
			const contentType = response.headers.get("content-type") || "";
			const probe = new TextDecoder("windows-1252").decode(bytes.slice(0, 4096));
			const encoding = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]
				|| probe.match(/charset\s*=\s*["']?([^\s;"'>]+)/i)?.[1] || "windows-1252";
			const html = new TextDecoder(encoding).decode(bytes);
			const parsed = parsePage(html, url);
			if (started !== generation) { throw new Error("Archive storage was cleared. Click the clock to reload."); }
			await ctx.setStorage(key, {schema, url, html, ...(isIndex ? {indexUpdate: ctx.act.lastUpdate} : {})});
			return parsed;
		})();
		pages.set(memoryKey, task);
		try { return await task; }
		catch (error) { pages.delete(memoryKey); throw error; }
	}

	async function loadIndex() {
		if (!indexPromise) {
			indexPromise = (async () => {
				let url = ctx.act.archiveURL;
				// Older cached acts keep the archive link in their information HTML.
				if (!url) {
					const doc = new DOMParser().parseFromString(ctx.act.info || "", "text/html");
					url = BJ.historyMetadata(doc, ctx.act.eli).archiveURL
						|| Array.from(doc.querySelectorAll("a[href]")).map(a => BJ.historyURL(a.getAttribute("href"), ctx.act.eli)).find(Boolean);
				}
				if (!url) { throw new Error("No archive link is available for this act"); }
				return downloadPage(url, true);
			})();
		}
		try { return await indexPromise; }
		catch (error) { indexPromise = undefined; throw error; }
	}

	function dateLabel(date) { return date ? date.split("-").reverse().join("/") : "Date unknown"; }
	function displayDate(state, index) {
		const version = state.versions[index];
		state.date.textContent = dateLabel(version.date);
		state.date.title = version.current ? "Latest text — entry into force" : "Archived text — entry into force";
	}
	function selectVersion(state, index) {
		state.selected = index;
		state.slider.value = index;
		displayDate(state, index);
		const version = state.versions[index];
		state.article.classList.toggle("article-historical", !version.current);
		state.current.hidden = !version.current;
		state.historical.hidden = version.current;
		if (!version.current) { state.historical.innerHTML = version.html; }
		state.status.replaceChildren();
		if (version.current) { state.status.textContent = "Latest version"; }
		else {
			const link = document.createElement("a");
			link.href = version.url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.textContent = "Archived version";
			state.status.appendChild(link);
		}
		state.status.append(` · ${index + 1}/${state.versions.length}`);
		state.slider.setAttribute("aria-valuetext", `${dateLabel(version.date)} — ${version.current ? "latest text" : "archived text"}`);
		// No current-text annotations or case-law blocks should remain over an archive.
		document.querySelectorAll("annotation").forEach(a => a.style.display = "none");
		$("#toolbar").hide();
		if (ctx.highlights) {
			ctx.highlights.selected.forEach(h => h.style.border = "");
			ctx.highlights.selected = [];
		}
		ctx.currentRange = undefined;
	}

	async function loadVersions(state) {
		const started = generation;
		const index = await loadIndex();
		if (started !== generation) { throw new Error("Archive storage was cleared. Click the clock to reload."); }
		const relevant = index.records.filter(r => r.groups.some(g => BJ.historyMatchesArticle(g.articles, state.number)));
		// Some sheets omit newly inserted articles (e.g. Art. 6ter of the 1980
		// special law). Match the insertion reference to its law and commencement
		// date, then use the last snapshot immediately preceding that insertion.
		for (const reference of BJ.historyArticleReferences(state.node.content).filter(r => /Inséré\s+par/i.test(r))) {
			const lawDate = reference.match(/\d{4}-\d{2}-\d{2}/)?.[0];
			const date = BJ.historyArticleDates(reference.replace(/</g, "&lt;")).at(-1);
			const insertion = index.records.filter(r => r.lawDate === lawDate && date && r.groups.some(g => g.date === date))
				.sort((a, b) => b.number - a.number)[0];
			if (insertion && !relevant.some(r => r.number === insertion.number)) { relevant.push(insertion); }
		}
		relevant.sort((a, b) => a.number - b.number);
		if (!relevant.length) { throw new Error("No earlier version of this article was found in the archive sheet"); }
		const versions = [];
		// Limit concurrent full-act downloads, especially for large constitutional texts.
		const loaded = new Array(relevant.length);
		let next = 0;
		await Promise.all(Array.from({length: Math.min(3, relevant.length)}, async () => {
			while (next < relevant.length) {
				if (started !== generation) { throw new Error("Archive storage was cleared. Click the clock to reload."); }
				const i = next++;
				const record = relevant[i];
				loaded[i] = await downloadPage(record.url, record.number === Number(new URL(index.url).searchParams.get("arch")));
			}
		}));
		for (let i = 0; i < relevant.length; i++) {
			const node = loaded[i].articles.get(state.number);
			const dates = node ? BJ.historyArticleDates(node.content) : [];
			const previousChange = i ? relevant[i - 1].groups.find(g => BJ.historyMatchesArticle(g.articles, state.number))?.date : null;
			versions.push({html: node?.content || `<div><b>${state.node.text.match(/^Art(?:\.|icle)\s*[^ ]+/)?.[0] || "Article"}</b></div><div>This article is not present in this archive.</div>`,
				date: node ? dates.at(-1) || previousChange || ctx.act.entryIntoForce || null : null, url: relevant[i].url});
		}
		const latestDate = BJ.historyArticleDates(state.node.content).at(-1)
			|| relevant.at(-1).groups.find(g => BJ.historyMatchesArticle(g.articles, state.number))?.date;
		versions.push({current: true, date: latestDate || null});
		if (started !== generation) { throw new Error("Archive storage was cleared. Click the clock to reload."); }
		state.versions = versions;
		state.slider.max = versions.length - 1;
		state.slider.disabled = versions.length < 2;
		state.ticks.replaceChildren(...versions.map((version, i) => {
			const tick = document.createElement("span");
			tick.className = "article-history-tick";
			tick.style.left = `${versions.length > 1 ? i / (versions.length - 1) * 100 : 50}%`;
			tick.title = dateLabel(version.date);
			return tick;
		}));
		selectVersion(state, versions.length - 1);
	}

	function addHistory(node) {
		const number = BJ.historyArticleNumber(node.text);
		if (!number || (!BJ.historyArticleReferences(node.content).length && !/abrog[ée]|supprim[ée]/i.test(node.content))) { return; }
		const article = document.getElementById("anchor_" + node.id);
		if (!article || article.querySelector(".article-history-clock")) { return; }
		const bookmark = article.querySelector("span.bookmark");
		if (bookmark) { bookmark.title = "Toggle bookmark for this article"; }
		article.classList.add("article-has-history");
		const current = document.createElement("section");
		current.className = "article-current-body";
		// Keep the current DOM intact, including its highlights and attached handlers.
		for (const child of Array.from(article.childNodes)) { if (child !== bookmark) { current.appendChild(child); } }
		article.appendChild(current);
		const historical = document.createElement("section");
		historical.className = "article-history-body";
		historical.hidden = true;
		article.appendChild(historical);
		const clock = document.createElement("button");
		clock.type = "button";
		clock.className = "article-history-clock";
		clock.title = "Show earlier versions of this article";
		clock.setAttribute("aria-label", clock.title);
		clock.setAttribute("aria-expanded", "false");
		clock.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l-3 2"/></svg>';
		const date = document.createElement("span");
		date.className = "article-history-date";
		const controls = document.createElement("section");
		controls.className = "article-history-controls";
		const slider = document.createElement("input");
		slider.type = "range";
		slider.min = "0";
		slider.max = "0";
		slider.step = "1";
		slider.disabled = true;
		slider.setAttribute("aria-label", `Version of article ${number}`);
		const ticks = document.createElement("section");
		ticks.className = "article-history-ticks";
		ticks.setAttribute("aria-hidden", "true");
		const status = document.createElement("span");
		status.className = "article-history-status";
		status.setAttribute("role", "status");
		controls.append(slider, ticks, status);
		const rail = document.createElement("section");
		rail.className = "article-history-rail";
		const row = document.createElement("section");
		row.className = "article-history-row";
		row.append(clock, date);
		if (bookmark) { row.appendChild(bookmark); }
		rail.append(row, controls);
		article.prepend(rail);
		const state = {node, number, article, clock, date, slider, ticks, status, current, historical, selected: 0,
			versions: [{current: true, date: BJ.historyArticleDates(node.content).at(-1) || null}]};
		states.push(state);
		displayDate(state, 0);
		clock.addEventListener("click", async () => {
			const open = !article.classList.contains("article-history-open");
			article.classList.toggle("article-history-open", open);
			clock.setAttribute("aria-expanded", String(open));
			if (!open) { selectVersion(state, state.versions.length - 1); return; }
			if (state.loaded || state.loading) { return; }
			state.loading = true;
			clock.classList.add("loading");
			clock.setAttribute("aria-busy", "true");
			status.textContent = "Loading archives…";
			try { await loadVersions(state); state.loaded = true; }
			catch (error) {
				console.warn("[Better Justel] Article history:", error);
				status.textContent = "Could not load archives. Close and reopen to retry.";
				status.title = error.message;
			}
			finally { state.loading = false; clock.classList.remove("loading"); clock.removeAttribute("aria-busy"); }
		});
		slider.addEventListener("input", () => selectVersion(state, Number(slider.value)));
		slider.addEventListener("pointermove", event => {
			if (slider.disabled || event.buttons) { return; }
			const rect = slider.getBoundingClientRect();
			// The thumb occupies half its width at each end of the native range track.
			const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 8) / Math.max(1, rect.width - 16)));
			displayDate(state, Math.round(ratio * Number(slider.max)));
		});
		slider.addEventListener("pointerleave", () => displayDate(state, state.selected));
	}

	function setupArticleHistory() {
		if (!ctx.act.entryIntoForce || !ctx.act.archiveURL) {
			const doc = new DOMParser().parseFromString(`<div id="list-title-1">${ctx.act.info || ""}</div>`, "text/html");
			const metadata = BJ.historyMetadata(doc, ctx.act.eli);
			ctx.act.entryIntoForce ||= metadata.entryIntoForce;
			ctx.act.archiveURL ||= metadata.archiveURL;
		}
		function visit(nodes) {
			for (const node of nodes) {
				if (node.type === "article") { addHistory(node); }
				if (node.children) { visit(node.children); }
			}
		}
		visit(ctx.act.content);
	}
	function reset() {
		generation++;
		pages.clear(); indexPromise = undefined;
		for (const state of states) {
			selectVersion(state, state.versions.length - 1);
			state.article.classList.remove("article-history-open");
			state.clock.setAttribute("aria-expanded", "false");
			state.loaded = false;
			state.slider.disabled = true;
		}
	}
	chrome.storage.onChanged?.addListener((changes, area) => {
		if (area === "local" && changes["archive-reset-" + ctx.act.eli]) { reset(); }
	});
	async function clearArticleHistory() {
		reset();
		await ctx.clearActArchives(ctx.act.eli);
	}
	return {setupArticleHistory, clearArticleHistory};
};
