(async function() {
    'use strict';

	const DROPBOX_CLIENT_ID = "bxh6gtfvn361dbe";
	const DROPBOX_REDIRECT_URL = "https://www.ejustice.just.fgov.be/eli/";
	const HEADINGS_TYPE = ["partie", "livre", "titre", "sous-titre", "chapitre", "section", "sous-section", "paragraphe", "§"];

	// Shared state object passed to all modules
	const ctx = {
		DROPBOX_CLIENT_ID,
		DROPBOX_REDIRECT_URL,
		HEADINGS_TYPE,
		act: {content: []},
		updateInfo: undefined,
		highlights: undefined,
		currentArticle: undefined,
		currentRange: undefined,
		highlightsBackup: undefined,
		numac2eli: undefined,
		headingsWhoseTypeNeedsToBeDefined: [],
	};

	let {getStorage, setStorage, getAllHighlights, clearActArchives} = await import(chrome.runtime.getURL('scripts/util.js'));
	Object.assign(ctx, {getStorage, setStorage, getAllHighlights, clearActArchives});

	// Initialize modules
	const {delay, showStatusMessage, updateStatusMessage, findObjectById, addLoading} = BJ.helpersModule();
	Object.assign(ctx, {delay, showStatusMessage, updateStatusMessage, findObjectById, addLoading});

	const {analyseContent, buildContent} = BJ.analyseModule(ctx);
	Object.assign(ctx, {buildContent});

	const {runDropboxBackup} = BJ.dropboxModule(ctx);
	Object.assign(ctx, {runDropboxBackup});

	const {updateBookmarkBar, manageHighlights} = BJ.highlightsModule(ctx);
	Object.assign(ctx, {updateBookmarkBar, manageHighlights});

	const {loadAndDisplayCaseLaw, clearCaselawFetchFlag, isInCaselawBlock, saveCaselawHighlight, removeCaselawHighlight, updateCaselawHighlight} = BJ.caselawModule(ctx);
	Object.assign(ctx, {loadAndDisplayCaseLaw, clearCaselawFetchFlag, isInCaselawBlock, saveCaselawHighlight, removeCaselawHighlight, updateCaselawHighlight});

	const {analyseFirstInfo, analyseFurtherInfo} = BJ.infoModule(ctx);

	const {setupArticleHistory, clearArticleHistory} = BJ.historyModule(ctx);
	Object.assign(ctx, {setupArticleHistory, clearArticleHistory});

	const {displayContent} = BJ.displayModule(ctx);

	function showLoadingError() {
		const loading = document.querySelector("div#loading");
		if (!loading) { return; }
		const retryUrl = window.location.origin + window.location.pathname
			+ `${window.location.search ? window.location.search + "&" : "?"}noJS=true`;
		const link = document.createElement("a");
		link.href = retryUrl;
		link.textContent = "here";
		loading.replaceChildren(
			document.createTextNode("Error while loading, click "),
			link,
			document.createTextNode(" to disable the extension or reload the page")
		);
	}

	function showPageError(message) {
		document.body.replaceChildren(document.createTextNode(message));
	}

	function getLastUpdateFromPartialHtml(html, fallbackDate) {
		const containerStart = html.search(/<div\b[^>]*id=["']list-title-1["'][^>]*>/i);
		if (containerStart < 0) { return undefined; }
		const relativeTitleStart = html.slice(containerStart)
			.search(/<p\b[^>]*class=["'][^"']*\blist-item--title\b[^"']*["'][^>]*>/i);
		if (relativeTitleStart < 0) { return undefined; }
		const titleStart = containerStart + relativeTitleStart;
		const titleEnd = html.indexOf("</p>", titleStart);
		if (titleEnd < 0) { return undefined; }
		const title = html.slice(titleStart, titleEnd);
		// Justel currently sends this response using a legacy character encoding, so the
		// accented "à" may arrive as an HTML entity or a replacement character.
		const update = title.match(/mise\s+\S+\s+jour au\s+(\d{2})-(\d{2})-(\d{4})/i);
		return update ? `${update[3]}-${update[2]}-${update[1]}` : fallbackDate;
	}

	async function getLastUpdateFromResponse(response, fallbackDate) {
		if (!response.body?.getReader) {
			const result = getLastUpdateFromPartialHtml(await response.text(), fallbackDate);
			if (result === undefined) { throw new Error("The Justel response did not contain the act information"); }
			return result;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let html = "";
		while (true) {
			const {done, value} = await reader.read();
			if (done) { break; }
			html += decoder.decode(value, {stream: true});
			const result = getLastUpdateFromPartialHtml(html, fallbackDate);
			if (result !== undefined) {
				await reader.cancel();
				return result;
			}
			if (html.length > 5 * 1024 * 1024) {
				await reader.cancel();
				throw new Error("The Justel act information was not found near the start of the response");
			}
		}
		html += decoder.decode();
		const result = getLastUpdateFromPartialHtml(html, fallbackDate);
		if (result === undefined) { throw new Error("The Justel response did not contain the act information"); }
		return result;
	}

	async function checkForUpdatedAct(eli) {
		if (!navigator.onLine) { return; }
		const today = new Date().toISOString().slice(0, 10);
		let updateInfo = await getStorage("updateInfo") || {};
		let cached = updateInfo[eli];
		if (!cached || cached.lastChecked === today || cached.lastCheckAttempt === today) { return; }

		// Record the attempt first so reopening the same large act does not repeatedly
		// contact Justel if the server is unavailable.
		cached.lastCheckAttempt = today;
		await setStorage("updateInfo", updateInfo);
		ctx.updateInfo = updateInfo;
		const status = showStatusMessage("Checking Justel for a newer version of this act…", 0);

		try {
			const response = await fetch(eli, {cache: "no-store", credentials: "include"});
			if (!response.ok) { throw new Error(`Justel returned HTTP ${response.status}`); }
			const onlineLastUpdate = await getLastUpdateFromResponse(response, cached.date);
			if (!onlineLastUpdate) { throw new Error("The latest update date could not be determined"); }

			if (onlineLastUpdate === cached.act) {
				updateInfo = await getStorage("updateInfo") || {};
				if (updateInfo[eli]) {
					updateInfo[eli].lastChecked = today;
					updateInfo[eli].lastCheckAttempt = today;
					await setStorage("updateInfo", updateInfo);
					ctx.updateInfo = updateInfo;
				}
				updateStatusMessage(status, "The stored act is up to date", 10000);
				return;
			}

			updateStatusMessage(status, "A newer version was found. Loading it from Justel…", 0);
			const result = await chrome.runtime.sendMessage({action: "refreshOnline", url: eli});
			if (!result?.ok) { throw new Error(result?.error || "Could not start the online refresh"); }
		}
		catch (e) {
			console.warn("[Better Justel] Background update check failed:", e.message);
			updateStatusMessage(status, "Could not check Justel for updates. The stored act remains available.", 10000);
		}
	}

	const {researchPage, processResultsPage} = BJ.searchModule();

	async function analyseAct() {
		try {
			addLoading("Analysing content of the act");
			analyseFurtherInfo();
			analyseContent();
			addLoading("Storing the act in offline database");
			await setStorage(ctx.act.eli, ctx.act);
			ctx.updateInfo[ctx.act.eli] =
				{
				act: ctx.act.lastUpdate,
				date: ctx.act.date,
				fullTitle: ctx.act.fullTitle,
				script: chrome.runtime.getManifest().version,
				lastChecked: new Date().toISOString().slice(0, 10),
				lastCheckAttempt: new Date().toISOString().slice(0, 10),
			};
			await setStorage("updateInfo", ctx.updateInfo);
		}
		catch(e) {
			showLoadingError();
			console.error(e.message);
			throw e;
		}
	}

	async function main() {
		console.log(`[Better Justel] main() started (readyState: "${document.readyState}", URL: ${window.location.href})`);
		// Check if we already consulted eJustice today for this page
		const currentURL = window.location.origin + window.location.pathname;
		const today = new Date().toISOString().slice(0, 10);
		ctx.updateInfo = await getStorage("updateInfo") || {};
		const cached = ctx.updateInfo[currentURL];
		if ( cached
			 && cached.script == chrome.runtime.getManifest().version
			 && cached.lastChecked == today ) {
			// Already checked today — restore from cache without contacting eJustice
			console.log(`[Better Justel] Already checked today (${today}) — restoring from cache`);
			ctx.act = await getStorage(currentURL);
			if (ctx.act?.content?.length) {
				window.stop();
				addLoading("Restoring page from offline database");
				await displayContent(false);
				return;
			}
			// Cache entry exists in updateInfo but act data missing — fall through to online check
			ctx.act = {content: []};
			console.warn("[Better Justel] Cache entry found but act data missing — falling back to online check");
		}
		// Identify act
		const infoResult = await analyseFirstInfo();
		if (infoResult?.timeout) {
			// Server is down — try to restore from cache
			console.warn("[Better Justel] Server timeout — attempting to restore from cache");
			// Try to find a cached version for this URL
			const cachedAct = await getStorage(currentURL);
			if (cachedAct?.content?.length) {
				window.stop();
				addLoading("Server unreachable — restoring page from offline database");
				ctx.act = cachedAct;
				await displayContent(false);
				return;
			}
			// No cache available — nothing we can do
			addLoading("Server unreachable and no cached version available. <a href='javascript:window.location.reload()'>Retry</a>");
			return;
		}
		console.log(`[Better Justel] Act identified: ${ctx.act.eli} (numac: ${ctx.act.numac}, lastUpdate: ${ctx.act.lastUpdate})`);
		// If URL is not ELI, redirect to ELI
		if ( (currentURL != ctx.act.eli)
				 && (ctx.act.eli.indexOf("cgi_") == -1) ) {
			console.log(`[Better Justel] Redirecting to ELI: ${ctx.act.eli}`);
			window.location.href = ctx.act.eli;
			return;
		}
		// Now, check whether the latest version of the act is stored in the database
		if ( (ctx.updateInfo[ctx.act.eli]?.script == chrome.runtime.getManifest().version)
			 && (ctx.updateInfo[ctx.act.eli]?.act == ctx.act.lastUpdate) ) {
			// Offline mode candidate — verify the cached data is actually present
			console.log("[Better Justel] Using cached version (offline mode)");
			const cachedEli = ctx.act.eli;
			const cachedAct = await getStorage(cachedEli);
			if (cachedAct?.content?.length) {
				window.stop();
				addLoading("Restoring page from offline database");
				ctx.act = cachedAct;
				// Record that we checked today
				ctx.updateInfo[cachedEli].lastChecked = today;
				ctx.updateInfo[cachedEli].lastCheckAttempt = today;
				await setStorage("updateInfo", ctx.updateInfo);
				await displayContent(false);
				return;
			}
			// Cache is corrupted/incomplete — mark as stale and fall through to online mode
			console.warn("[Better Justel] Cached act data missing or empty — forcing online reload");
			ctx.updateInfo[cachedEli].act = false;
			await setStorage("updateInfo", ctx.updateInfo);
		}
		// Online mode
		// Page must be loaded and analysed since it cannot be restored
		{
			console.log(`[Better Justel] Online mode — need to load and analyse page (readyState: "${document.readyState}", ` +
				`cachedScript: ${ctx.updateInfo[ctx.act.eli]?.script || "none"}, currentScript: ${chrome.runtime.getManifest().version}, ` +
				`cachedAct: ${ctx.updateInfo[ctx.act.eli]?.act || "none"}, currentAct: ${ctx.act.lastUpdate})`);
			addLoading("Loading page from Justel server");

			// Safety timeout: if page analysis doesn't start within 45s, try cache fallback
			const safetyTimer = setTimeout(async () => {
				console.error(`[Better Justel] Safety timeout: page analysis did not start within 45s (readyState: "${document.readyState}").`);
				const cachedAct = await getStorage(ctx.act.eli);
				if (cachedAct?.content?.length) {
					console.log("[Better Justel] Falling back to cached version after safety timeout");
					window.stop();
					addLoading("Server unreachable — restoring page from offline database");
					ctx.act = cachedAct;
					await displayContent(false);
				} else {
					addLoading("Server unreachable and no cached version available. <a href='javascript:window.location.reload()'>Retry</a>");
				}
			}, 45000);

			async function runAnalysis() {
				clearTimeout(safetyTimer);
				console.log(`[Better Justel] DOM ready — starting analysis (readyState: "${document.readyState}")`);
				await analyseAct();
				await displayContent(true);
			}

			if (document.readyState === "loading") {
				// DOM not yet parsed — wait for DOMContentLoaded
				console.log("[Better Justel] Waiting for DOMContentLoaded...");
				document.addEventListener("DOMContentLoaded", runAnalysis);
			} else {
				// DOM already parsed (readyState is "interactive" or "complete")
				console.log(`[Better Justel] DOM already parsed (readyState: "${document.readyState}"), proceeding immediately`);
				await runAnalysis();
			}
		}
	}
	
	// Start of the script
	ctx.highlightsBackup = await getStorage("highlightsBackup") || {};
	ctx.numac2eli = await getStorage("numac2eli") || {};
	let u = new URLSearchParams(window.location.search);
	if (u.get("arrexec") || u.get("arch") || u.get("noJS") || (u.get("language") && u.get("language") != "fr")) {
		// Disable extension if royal decrees page, archive page, user clicked on "Original Justel", or non-French version
		return;
	}
	else if ( window.location.pathname.startsWith("/cgi_") && window.location.pathname.endsWith("/rech.pl") ) {
		// Main search page
		researchPage();
	}
	else if ( window.location.pathname.startsWith("/cgi_") && (window.location.pathname.endsWith("/rech_res.pl") || window.location.pathname.endsWith("/list.pl")) ) {
		// Search results / list page
		processResultsPage();
	}
	else if ( (window.location.origin + window.location.pathname) == "https://www.ejustice.just.fgov.be/eli/" ) {
		// ELI about page
		// Test if redirect from Dropbox
		if ( window.location.search.match(/code/) ) {
			let dbxAuth = new Dropbox.DropboxAuth({
				clientId: DROPBOX_CLIENT_ID,
			});
			dbxAuth.setCodeVerifier(ctx.highlightsBackup.codeVerifier);
			let u = new URLSearchParams(window.location.search);
			let response = await dbxAuth.getAccessTokenFromCode(DROPBOX_REDIRECT_URL, u.get("code"));
			ctx.highlightsBackup.accessToken = response.result.access_token;
			ctx.highlightsBackup.refreshToken = response.result.refresh_token;
			await setStorage("highlightsBackup", ctx.highlightsBackup);
			window.location.href = ctx.highlightsBackup.redirect;
		}
		else if ( window.location.search.match(/error/) ) {
			alert("User refused to grant access to Dropbox");
			if (ctx.highlightsBackup?.redirect) { window.location.href = ctx.highlightsBackup.redirect; }
		}
	}
	else if ( (window.location.protocol == "chrome-extension:") || (window.location.protocol == "moz-extension:") ) { 
		let u = new URLSearchParams(window.location.search);
		let eli = u.get("eli");
		if (!eli) {
			showPageError("Error, you shouldn't access this page directly");
		}
		else {
			addLoading("Restoring page from offline database");
			ctx.updateInfo = await getStorage("updateInfo") || {};
			ctx.act = await getStorage(eli);
			if (ctx.act?.content?.length) {
				await displayContent(false);
				checkForUpdatedAct(eli).catch(e => console.error(e));
			}
			else {
				if (navigator.onLine) {
					const result = await chrome.runtime.sendMessage({action: "refreshOnline", url: eli});
					if (!result?.ok) { showPageError(result?.error || `Error loading ${eli}`); }
				}
				else {
					showPageError(`Error, ${eli} has not been stored in the offline database`);
				}
			}
		}
	}
	else {
		// Specific statute page
		main();
	}
})();
