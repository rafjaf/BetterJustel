window.BJ = window.BJ || {};
window.BJ.caselawModule = function(ctx) {

	const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/rafjaf/juportal_crawler/main/data/";
	const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

	const FRENCH_MONTHS = [
		"janvier", "février", "mars", "avril", "mai", "juin",
		"juillet", "août", "septembre", "octobre", "novembre", "décembre"
	];

	/** Map raw court identifiers from Juportal to display abbreviations. */
	const COURT_ABBR_MAP = {
		"CASS": "Cass.",
		"CC":   "C.C.",
		"CE":   "C.E.",
	};

	/**
	 * Deduplicate near-identical abstracts.
	 * Some abstracts differ only by a stray footnote digit or trivial whitespace;
	 * a plain Set() won't catch those.
	 */
	function deduplicateAbstracts(abstracts) {
		const normalize = s => s.replace(/\s+/g, " ").trim();
		const result = [];
		for (const a of abstracts) {
			const na = normalize(a);
			let dominated = false;
			for (const r of result) {
				const nr = normalize(r);
				if (na === nr) { dominated = true; break; }
				// Check similarity: common prefix + suffix should cover >95% of the longer string
				const maxLen = Math.max(na.length, nr.length);
				if (maxLen === 0) { dominated = true; break; }
				const diff = Math.abs(na.length - nr.length);
				if (diff / maxLen > 0.03) continue; // >3% length difference → not near-identical
				let prefixLen = 0;
				while (prefixLen < Math.min(na.length, nr.length) && na[prefixLen] === nr[prefixLen]) prefixLen++;
				let suffixLen = 0;
				while (suffixLen < (Math.min(na.length, nr.length) - prefixLen)
					&& na[na.length - 1 - suffixLen] === nr[nr.length - 1 - suffixLen]) suffixLen++;
				if ((prefixLen + suffixLen) / maxLen > 0.95) { dominated = true; break; }
			}
			if (!dominated) result.push(a);
		}
		return result;
	}

	/**
	 * Determine the JSON filename for the current act.
	 * ELI-type: eli/constitution/1994/02/17/1994021048/justel → eli_constitution_1994_02_17_1994021048_justel.json
	 * cgi_loi-type: uses Dossiernummer/Dossier numéro from ctx.act.info → cgi_loi_loi_YYYYMMDDNN.json
	 */
	function getCaselawFilename() {
		const eli = ctx.act.eli;
		if (!eli) return null;

		if (eli.indexOf("/eli/") !== -1) {
			// ELI-type URL
			const path = new URL(eli).pathname; // e.g. /eli/constitution/1994/02/17/1994021048/justel
			const filename = path.slice(1).replace(/\//g, "_") + ".json"; // eli_constitution_1994_02_17_1994021048_justel.json
			return filename;
		}
		else if (eli.indexOf("cgi_loi") !== -1 || eli.indexOf("cgi_") !== -1) {
			// Non-ELI type — need Dossier numéro
			const dossierMatch = ctx.act.info?.match(/[Dd]ossier\s*num[ée]ro\s*:?\s*<\/strong>\s*([^<]+)/i)
							  || ctx.act.info?.match(/[Dd]ossiernummer\s*:?\s*<\/strong>\s*([^<]+)/i);
			if (dossierMatch) {
				const dossier = dossierMatch[1].trim(); // e.g. "1984-11-22/33"
				const sanitized = dossier.replace(/[-\/]/g, ""); // e.g. "1984112233"
				return "cgi_loi_loi_" + sanitized + ".json";
			}
			console.log("[Better Justel - Case Law] No Dossier numéro found for non-ELI text");
			return null;
		}
		return null;
	}

	/**
	 * Sanitize JSON data to prevent code injection.
	 * Only keep expected keys and types.
	 */
	function sanitizeCaselawData(rawData) {
		if (typeof rawData !== "object" || rawData === null || Array.isArray(rawData)) {
			return null;
		}
		const clean = {};
		for (const articleKey of Object.keys(rawData)) {
			// Article keys should be strings (numbers, possibly with bis/ter etc.)
			if (typeof rawData[articleKey] !== "object" || rawData[articleKey] === null) continue;
			clean[articleKey] = {};
			for (const ecli of Object.keys(rawData[articleKey])) {
				const decision = rawData[articleKey][ecli];
				if (typeof decision !== "object" || decision === null) continue;
				const sanitizedDecision = {
					court: typeof decision.court === "string" ? decision.court.replace(/<[^>]*>/g, "") : "",
					date: typeof decision.date === "string" ? decision.date.replace(/<[^>]*>/g, "") : "",
					roleNumber: typeof decision.roleNumber === "string" ? decision.roleNumber.replace(/<[^>]*>/g, "") : "",
					url: typeof decision.url === "string" && decision.url.match(/^https?:\/\//) ? decision.url : "",
					abstractFR: null,
					abstractNL: null,
				};
				if (Array.isArray(decision.abstractFR)) {
					sanitizedDecision.abstractFR = decision.abstractFR
						.filter(a => typeof a === "string")
						.map(a => a.replace(/<[^>]*>/g, ""));
				}
				if (Array.isArray(decision.abstractNL)) {
					sanitizedDecision.abstractNL = decision.abstractNL
						.filter(a => typeof a === "string")
						.map(a => a.replace(/<[^>]*>/g, ""));
				}
				clean[articleKey][ecli] = sanitizedDecision;
			}
		}
		return clean;
	}

	/**
	 * Fetch case-law data from Juportal Crawler GitHub repo.
	 * Caches in localStorage as "caselaw-{eli}" and throttles to once per day per ELI.
	 * Returns the case-law data object, or null if none available.
	 */
	async function fetchCaseLaw() {
		const eli = ctx.act.eli;
		const fetchInfoKey = "caselaw-fetch-" + eli;
		const caselawKey = "caselaw-" + eli;

		// Check if we already fetched recently (within 24h)
		const fetchInfo = await ctx.getStorage(fetchInfoKey);
		if (fetchInfo && fetchInfo.lastFetch) {
			const elapsed = Date.now() - fetchInfo.lastFetch;
			if (elapsed < FETCH_INTERVAL_MS) {
				console.log(`[Better Justel - Case Law] Skipping fetch for ${eli} — last fetched ${Math.round(elapsed / 60000)} minutes ago`);
				const cached = await ctx.getStorage(caselawKey);
				if (cached) {
					console.log(`[Better Justel - Case Law] Using cached case-law data (${countAbstracts(cached)} abstracts)`);
				}
				return { data: cached || null, newAbstracts: 0, newArticles: 0 };
			}
		}

		// Determine filename
		const filename = getCaselawFilename();
		if (!filename) {
			console.log("[Better Justel - Case Law] Cannot determine Juportal Crawler filename for this act");
			return { data: await ctx.getStorage(caselawKey) || null, newAbstracts: 0, newArticles: 0 };
		}

		const url = GITHUB_RAW_BASE + filename;
		console.log(`[Better Justel - Case Law] Accessing Juportal Crawler database: ${url}`);

		try {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 404) {
					console.log(`[Better Justel - Case Law] No case-law data found on Juportal Crawler for ${eli}`);
				} else {
					console.warn(`[Better Justel - Case Law] HTTP error ${response.status} fetching case-law for ${eli}`);
				}
				// Record the fetch attempt even on failure to avoid re-fetching too soon
				await ctx.setStorage(fetchInfoKey, { lastFetch: Date.now() });
				return { data: await ctx.getStorage(caselawKey) || null, newAbstracts: 0, newArticles: 0 };
			}

			const rawText = await response.text();
			let rawData;
			try {
				rawData = JSON.parse(rawText);
			} catch (e) {
				console.error("[Better Justel - Case Law] Invalid JSON received from Juportal Crawler:", e.message);
				await ctx.setStorage(fetchInfoKey, { lastFetch: Date.now() });
				return { data: await ctx.getStorage(caselawKey) || null, newAbstracts: 0, newArticles: 0 };
			}

			// Sanitize
			const cleanData = sanitizeCaselawData(rawData);
			if (!cleanData) {
				console.error("[Better Justel - Case Law] Sanitization failed — data discarded");
				await ctx.setStorage(fetchInfoKey, { lastFetch: Date.now() });
				return { data: await ctx.getStorage(caselawKey) || null, newAbstracts: 0, newArticles: 0 };
			}

			const totalAbstracts = countAbstracts(cleanData);
			console.log(`[Better Justel - Case Law] Successfully fetched ${totalAbstracts} abstracts for ${eli}`);

			// Check for updates vs cached version
			const cachedData = await ctx.getStorage(caselawKey);
			let newAbstracts = 0;
			if (cachedData) {
				const oldCount = countAbstracts(cachedData);
				if (totalAbstracts !== oldCount) {
					console.log(`[Better Justel - Case Law] Detected updates: ${oldCount} \u2192 ${totalAbstracts} abstracts`);
					newAbstracts = Math.max(0, totalAbstracts - oldCount);
				} else {
					console.log("[Better Justel - Case Law] No updates detected \u2014 data unchanged");
				}
			} else {
				// First-time fetch \u2014 all abstracts are new
				newAbstracts = totalAbstracts;
			}
			const newArticles = Object.keys(cleanData).length;

			// Save to localStorage
			await ctx.setStorage(caselawKey, cleanData);
			await ctx.setStorage(fetchInfoKey, { lastFetch: Date.now() });

			return { data: cleanData, newAbstracts, newArticles };
		}
		catch (e) {
			console.error("[Better Justel - Case Law] Network error fetching case-law:", e.message);
			await ctx.setStorage(fetchInfoKey, { lastFetch: Date.now() });
			return { data: await ctx.getStorage(caselawKey) || null, newAbstracts: 0, newArticles: 0 };
		}
	}

	/**
	 * Count total number of abstracts across all articles.
	 */
	function countAbstracts(data) {
		let count = 0;
		for (const artKey of Object.keys(data)) {
			for (const ecli of Object.keys(data[artKey])) {
				const d = data[artKey][ecli];
				if (d.abstractFR?.length) count += d.abstractFR.length;
				else if (d.abstractNL?.length) count += d.abstractNL.length;
			}
		}
		return count;
	}

	/**
	 * Extract article number from the article text used in ctx.act (e.g. "Art. 10" → "10", "Art. 1382bis" → "1382bis").
	 */
	function extractArticleNumber(text) {
		if (!text) return null;
		const m = text.match(/Art(?:\.|icle)\s*L?R?([IVX]+|\d+(?:\w*)?(?:[.\/:-]\d+)*)/i);
		return m ? m[1] : null;
	}

	/**
	 * Format a date as "DD mois YYYY" in French.
	 */
	function formatDateFrench(dateStr) {
		if (!dateStr) return "";
		const parts = dateStr.split("-");
		if (parts.length !== 3) return dateStr;
		const day = parseInt(parts[2], 10);
		const monthIndex = parseInt(parts[1], 10) - 1;
		const year = parts[0];
		if (monthIndex < 0 || monthIndex > 11) return dateStr;
		return `${day} ${FRENCH_MONTHS[monthIndex]} ${year}`;
	}

	/**
	 * Build the HTML for case-law abstracts for a given article.
	 * Sorts decisions by date (most recent first).
	 * Displays FR abstracts by priority, NL if FR unavailable.
	 * Deduplicates identical abstracts for the same judgement.
	 */
	function buildCaselawHTML(articleData) {
		// Collect all decisions and sort by date (most recent first)
		const decisions = Object.entries(articleData)
			.map(([ecli, d]) => ({ ecli, ...d }))
			.sort((a, b) => b.date.localeCompare(a.date));

		const items = [];
		for (const d of decisions) {
			// Choose FR abstracts by priority, NL as fallback
			let abstracts = [];
			if (d.abstractFR && d.abstractFR.length > 0) {
				abstracts = d.abstractFR;
			} else if (d.abstractNL && d.abstractNL.length > 0) {
				abstracts = d.abstractNL;
			}
			if (!abstracts.length) continue;

			// Deduplicate near-identical abstracts for the same judgement
			const uniqueAbstracts = deduplicateAbstracts(abstracts);

			const formattedDate = formatDateFrench(d.date);
			const courtAbbr = COURT_ABBR_MAP[d.court] || d.court || "";
			const roleNumber = d.roleNumber || "";
			const urlLink = d.url
				? `<a href="${d.url}" target="_blank">${formattedDate}</a>`
				: formattedDate;
			const citation = `(${courtAbbr}, ${urlLink}, n° ${roleNumber})`;

			for (const abstract of uniqueAbstracts) {
				items.push(`<li>${abstract} : ${citation}</li>`);
			}
		}

		return items.length ? `<ol>${items.join("")}</ol>` : "";
	}

	/**
	 * Recursively walk the act tree and collect article nodes with their metadata.
	 */
	function collectArticles(nodes) {
		const result = [];
		for (const n of nodes) {
			if (n.type === "article") {
				result.push(n);
			}
			if (n.children?.length) {
				result.push(...collectArticles(n.children));
			}
		}
		return result;
	}

	/**
	 * Inject case-law blocks under each article in the displayed content.
	 */
	function displayCaseLaw(caselawData) {
		if (!caselawData) return;

		const articles = collectArticles(ctx.act.content);
		let articlesWithCaselaw = 0;

		for (const article of articles) {
			const artNumber = extractArticleNumber(article.text);
			if (!artNumber || !caselawData[artNumber]) continue;

			const articleData = caselawData[artNumber];
			const totalDecisions = Object.keys(articleData).length;
			// Count unique abstracts (using same dedup logic as buildCaselawHTML)
			let totalAbstracts = 0;
			for (const ecli of Object.keys(articleData)) {
				const d = articleData[ecli];
				if (d.abstractFR?.length) totalAbstracts += deduplicateAbstracts(d.abstractFR).length;
				else if (d.abstractNL?.length) totalAbstracts += deduplicateAbstracts(d.abstractNL).length;
			}
			if (!totalAbstracts) continue;

			const html = buildCaselawHTML(articleData);
			if (!html) continue;

			const caselawBlock = document.createElement("div");
			caselawBlock.classList.add("caselaw-block");
			caselawBlock.innerHTML =
				`<div class="caselaw-border-bar" title="Click to toggle"></div>` +
				`<div class="caselaw-header" role="button" tabindex="0">` +
				`<span class="caselaw-toggle">▶</span> Case law (${totalAbstracts}) on Article ${artNumber}</div>` +
				`<div class="caselaw-content" style="display: none;">${html}</div>`;

			// Insert after the article div
			const articleDiv = document.querySelector(`div#anchor_${article.id}`);
			if (articleDiv) {
				articleDiv.appendChild(caselawBlock);
				articlesWithCaselaw++;
			}
		}

		// Set up toggle behaviour
		function toggleCaselawBlock(block) {
			const content = block.querySelector(".caselaw-content");
			const toggle = block.querySelector(".caselaw-toggle");
			if (content.style.display === "none") {
				content.style.display = "block";
				toggle.textContent = "▼";
			} else {
				content.style.display = "none";
				toggle.textContent = "▶";
			}
		}

		document.querySelectorAll("div.caselaw-header").forEach(header => {
			header.addEventListener("click", function() {
				toggleCaselawBlock(this.closest(".caselaw-block"));
			});
		});

		document.querySelectorAll("div.caselaw-border-bar").forEach(bar => {
			bar.addEventListener("click", function() {
				toggleCaselawBlock(this.closest(".caselaw-block"));
			});
		});
		document.querySelectorAll("div.caselaw-header").forEach(header => {
			header.addEventListener("keydown", function(e) {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.click();
				}
			});
		});

		console.log(`[Better Justel - Case Law] Displayed case-law for ${articlesWithCaselaw} articles`);
	}

	/**
	 * Load highlights specific to case-law abstracts.
	 * These are stored separately in "highlights-caselaw-{eli}" to avoid
	 * being deleted by the main highlight system which prunes highlights
	 * for text that no longer appears (e.g. repealed articles).
	 */
	async function loadCaselawHighlights() {
		const key = "highlights-caselaw-" + ctx.act.eli;
		const quotes = await ctx.getStorage(key) || {};
		let changesMade = false;

		for (const articleId in quotes) {
			const articleDiv = document.querySelector(`div#anchor_${articleId}`);
			const caselawContent = articleDiv?.querySelector(".caselaw-content");
			if (!caselawContent) {
				console.info(`[Better Justel - Case Law] Article ${articleId} no longer has case-law, deleting case-law highlights`);
				delete quotes[articleId];
				changesMade = true;
				continue;
			}

			const toRemove = [];
			for (let i = 0; i < quotes[articleId].length; i++) {
				const q = quotes[articleId][i];
				try {
					const range = anchoring.TextQuoteAnchor.toRange(caselawContent, q);
					if (!range) {
						console.info(`[Better Justel - Case Law] Cannot anchor quote in article ${articleId}, removing`);
						toRemove.push(i);
						continue;
					}
					const h = document.createElement("highlight");
					h.id = q.id;
					h.classList.add(q.color);
					if (q.annotation) { h.classList.add("annotated"); }
					const wrapper = anchoring.WrapRangeText(h, range);
					ctx.highlights.wrappers[h.id] = wrapper;
				} catch (e) {
					console.warn(`[Better Justel - Case Law] Error anchoring case-law highlight:`, e.message);
					toRemove.push(i);
				}
			}

			// Remove failed highlights (reverse order to preserve indices)
			for (let i = toRemove.length - 1; i >= 0; i--) {
				quotes[articleId].splice(toRemove[i], 1);
			}
			if (!quotes[articleId].length) {
				delete quotes[articleId];
				changesMade = true;
			} else if (toRemove.length) {
				changesMade = true;
			}
		}

		if (changesMade) {
			await ctx.setStorage(key, quotes);
		}

		return quotes;
	}

	/**
	 * Save a case-law highlight. Called from the main highlight system
	 * when the highlight is within a case-law block.
	 */
	async function saveCaselawHighlight(articleId, quoteSelector) {
		const key = "highlights-caselaw-" + ctx.act.eli;
		const quotes = await ctx.getStorage(key) || {};
		quotes[articleId] = quotes[articleId] || [];
		quotes[articleId].push(quoteSelector);
		await ctx.setStorage(key, quotes);
	}

	/**
	 * Remove a case-law highlight by ID.
	 * Note: the highlight element may already be detached from the DOM
	 * (unwrapped before this is called), so we search all article keys.
	 */
	async function removeCaselawHighlight(highlightElement) {
		const key = "highlights-caselaw-" + ctx.act.eli;
		const quotes = await ctx.getStorage(key) || {};

		for (const artId in quotes) {
			const idx = quotes[artId].findIndex(q => q.id === highlightElement.id);
			if (idx !== -1) {
				quotes[artId].splice(idx, 1);
				if (!quotes[artId].length) delete quotes[artId];
				await ctx.setStorage(key, quotes);
				return;
			}
		}
	}

	/**
	 * Update a case-law highlight (color, annotation).
	 */
	async function updateCaselawHighlight(highlightElement, updates) {
		const key = "highlights-caselaw-" + ctx.act.eli;
		const quotes = await ctx.getStorage(key) || {};

		for (const artId in quotes) {
			const idx = quotes[artId].findIndex(q => q.id === highlightElement.id);
			if (idx !== -1) {
				Object.assign(quotes[artId][idx], updates);
				await ctx.setStorage(key, quotes);
				return;
			}
		}
	}

	/**
	 * Check if a highlight element is inside a case-law block.
	 */
	function isInCaselawBlock(element) {
		if (!element) return false;
		// If element is a text node, use its parent element
		let el = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
		return !!$(el).closest(".caselaw-block").length;
	}

	/**
	 * Clear the fetch timestamp for this act, allowing a re-check on the same day.
	 */
	async function clearCaselawFetchFlag() {
		const eli = ctx.act.eli;
		await ctx.setStorage("caselaw-fetch-" + eli, null);
		await ctx.setStorage("caselaw-" + eli, null);
		console.log(`[Better Justel - Case Law] Cleared case-law data and fetch flag for ${eli}`);
	}

	/**
	 * Main entry point: fetch case-law data and display it.
	 */
	async function loadAndDisplayCaseLaw() {
		try {
			const { data: caselawData, newAbstracts, newArticles } = await fetchCaseLaw();
			if (caselawData && Object.keys(caselawData).length > 0) {
				displayCaseLaw(caselawData);
				// Load case-law highlights after blocks are injected
				ctx.caselawHighlights = await loadCaselawHighlights();
				if (newAbstracts > 0) {
					const aStr = newAbstracts === 1 ? "abstract" : "abstracts";
					const artStr = newArticles === 1 ? "article" : "articles";
					ctx.showStatusMessage(`Fetched ${newAbstracts} new case law ${aStr} for ${newArticles} ${artStr} from Juportal database`);
				}
			} else {
				console.log("[Better Justel - Case Law] No case-law data to display");
			}
		} catch (e) {
			console.error("[Better Justel - Case Law] Error loading case-law:", e.message);
		}
	}

	return {
		loadAndDisplayCaseLaw,
		clearCaselawFetchFlag,
		isInCaselawBlock,
		saveCaselawHighlight,
		removeCaselawHighlight,
		updateCaselawHighlight,
	};
};
