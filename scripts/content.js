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

	let {getStorage, setStorage, getAllHighlights} = await import(chrome.runtime.getURL('scripts/util.js'));
	Object.assign(ctx, {getStorage, setStorage, getAllHighlights});

	// Initialize modules
	const {delay, showStatusMessage, findObjectById, addLoading} = BJ.helpersModule();
	Object.assign(ctx, {delay, showStatusMessage, findObjectById, addLoading});

	const {analyseContent, buildContent} = BJ.analyseModule(ctx);
	Object.assign(ctx, {buildContent});

	const {runDropboxBackup} = BJ.dropboxModule(ctx);
	Object.assign(ctx, {runDropboxBackup});

	const {updateBookmarkBar, manageHighlights} = BJ.highlightsModule(ctx);
	Object.assign(ctx, {updateBookmarkBar, manageHighlights});

	const {analyseFirstInfo, analyseFurtherInfo} = BJ.infoModule(ctx);

	const {displayContent} = BJ.displayModule(ctx);

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
			};
			await setStorage("updateInfo", ctx.updateInfo);
		}
		catch(e) {
			document.querySelector("div#loading").innerHTML = `Error while loading, click <a href=${window.location.origin + window.location.pathname}`
				+`${window.location.search ? window.location.search + "&" : "?"}noJS=true>here</a> to disable the extension or reload the page`;
			console.error(e.message);
			throw e;
		}
	}

	async function main() {
		// Identify act
		await analyseFirstInfo();
		// If URL is not ELI, redirect to ELI
		if ( ((window.location.origin + window.location.pathname) != ctx.act.eli)
			 && (ctx.act.eli.indexOf("cgi_loi") == -1) ) {
			window.location.href = ctx.act.eli;
			return;
		}
		// Now, check whether the latest version of the act is stored in the database
		ctx.updateInfo = await getStorage("updateInfo") || {};
		if ( (ctx.updateInfo[ctx.act.eli]?.script == chrome.runtime.getManifest().version)
			 && (ctx.updateInfo[ctx.act.eli]?.act == ctx.act.lastUpdate) ) {
			// Offline mode
			// Page can be restored since it did not change (nor the script)
			window.stop();
			addLoading("Restoring page from offline database");
			ctx.act = await getStorage(ctx.act.eli);
			await displayContent(false);
		}
		else {
			// Online mode
			// Page must be loaded and analysed since it cannot be restored
			addLoading("Loading page from Justel server");
			if (document.readyState == "complete") {
				await analyseAct();
				await displayContent(true);
			}
			else {
				document.addEventListener("DOMContentLoaded", async () => {
					await analyseAct();
					await displayContent(true);
				});
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
	else if ( (window.location.origin + window.location.pathname) == "https://www.ejustice.just.fgov.be/cgi_loi/rech.pl" ) {
		// Main search page
		researchPage();
	}
	else if ( (window.location.origin + window.location.pathname) == "https://www.ejustice.just.fgov.be/cgi_loi/rech_res.pl"
		|| (window.location.origin + window.location.pathname) == "https://www.ejustice.just.fgov.be/cgi_loi/list.pl" ) {
		// Main search page
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
			document.write("Error, you shouldn't access this page directly")
		}
		else {
			if (navigator.onLine) {
				// Let's redirect to online page since we are online
				window.location.href = eli;
				return;
			}
			// Offline mode
			addLoading("Restoring page from offline database");
			ctx.act = await getStorage(eli);
			if (ctx.act) {
				await displayContent(false);
			}
			else {
				document.write(`Error, ${eli} has not been stored in the offline database`);
			}
		}
	}
	else {
		// Specific statute page
		main();
	}
})();
