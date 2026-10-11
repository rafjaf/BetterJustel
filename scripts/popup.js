const DROPBOX_CLIENT_ID = "bxh6gtfvn361dbe";
const DROPBOX_REDIRECT_URL = "https://www.ejustice.just.fgov.be/eli/";

import {getStorage, setStorage, getAllHighlights, clearActArchives, requestDataCollectionPermissions} from "../scripts/util.js";
import {parseJustelQuery, buildJustelSearchUrl} from "../scripts/popup-search.js";

function getDownload() {
	if (typeof window.download !== "function") {
		throw new Error("Download library is not loaded");
	}
	return window.download;
}

function getDropbox() {
	if (!window.Dropbox?.DropboxAuth) {
		throw new Error("Dropbox SDK is not loaded");
	}
	return window.Dropbox;
}

function runPopupCommand(handler) {
	return async function(event) {
		event.preventDefault();
		try {
			await handler(event);
		}
		catch (e) {
			console.error(e);
			alert(e.message || "The command failed");
		}
	};
}

function updateJustelSearchState(value, hasStoredActs) {
	const raw = value.trim();
	const query = parseJustelQuery(raw);
	const message = document.querySelector("#noStoredActsMessage");
	message.textContent = raw
		? `No stored act matches “${raw}”. You can continue the search on Justel.`
		: (hasStoredActs
			? "No stored act matches this filter."
			: "No acts are stored offline yet. Search Justel to find one.");

	const description = document.querySelector("#justelSearchDescription");
	if (!raw) {
		description.textContent = "Enter terms above to search act titles on Justel.";
	}
	else if (query.date && query.title) {
		description.textContent = `Search “${query.title}” in act titles with the detected promulgation date.`;
	}
	else if (query.date) {
		description.textContent = "Search acts with the detected promulgation date.";
	}
	else {
		description.textContent = "Search these terms in act titles.";
	}

	const date = document.querySelector("#justelDetectedDate");
	date.hidden = !query.date;
	date.querySelector("strong").textContent = query.date;

	const button = document.querySelector("#searchJustel");
	button.disabled = !raw;
	for (const link of document.querySelectorAll("a[data-justel-nature]")) {
		if (raw) {
			link.href = buildJustelSearchUrl(raw, link.dataset.justelNature);
			link.removeAttribute("aria-disabled");
			link.tabIndex = 0;
		}
		else {
			link.removeAttribute("href");
			link.setAttribute("aria-disabled", "true");
			link.tabIndex = -1;
		}
	}
}

function launchJustelSearch() {
	const value = document.querySelector("input#search").value;
	if (!value.trim()) { return; }
	chrome.tabs.create({url: buildJustelSearchUrl(value)});
}

async function importHighlights() {
	// Let the user pick a JSON file instead of pasting raw JSON
	const fileList = await new Promise(resolve => {
		const el = document.createElement('input');
		el.type = 'file';
		el.accept = '.json,application/json';
		el.style.display = 'none';
		document.body.appendChild(el);
		el.addEventListener('change', () => {
			resolve(el.files);
			el.remove();
		}, { once: true });
		el.click();
	});
	const file = fileList && fileList[0];
	if (!file) { return; }
	let text;
	try {
		text = await file.text();
	}
	catch (e) {
		alert('Unable to read file');
		return;
	}
	let inputObj;
	try {
		inputObj = JSON.parse(text);
	}
	catch(e) {
		alert("Invalid JSON file");
		return;
	}
	// Save imported highlights (same behaviour as before)
	let counter = 0;
	for (const key in inputObj) {
		if (key.startsWith("highlights-")) {
			await setStorage(key, inputObj[key]);
			counter += 1;
		}
	}
	alert(`Imported highlights for ${counter} acts`);
}

async function toggleDropboxBackup() {
	let highlightsBackup = await getStorage("highlightsBackup") || {};
	if (highlightsBackup.accessToken) {
		let choice = confirm("Press OK to disable Dropbox backup of highlights");
		if (choice) {
			highlightsBackup = {};
			await setStorage("highlightsBackup", highlightsBackup);
			document.querySelector("a#toggleDropboxBackup").innerText = "Enable Dropbox backup of highlights";
		}
	}
	else {
		const dataConsentGranted = await requestDataCollectionPermissions([
			"browsingActivity",
			"websiteContent",
			"websiteActivity",
		]);
		if (!dataConsentGranted) {
			alert("Dropbox backup was not enabled because Firefox data collection consent was not granted.");
			return;
		}
		const Dropbox = getDropbox();
		let dbxAuth = new Dropbox.DropboxAuth({
			clientId: DROPBOX_CLIENT_ID,
		});
		highlightsBackup.filename = prompt("Please enter the file name of backups", "Highlights Backup");
		if (!highlightsBackup.filename?.trim()) { return; }
		highlightsBackup.filename = highlightsBackup.filename.trim();
		alert("You will now be redirected to authorize this app to access your Dropbox. Access is only requested to a folder dedicated to this app. No access will be granted to the rest of your Dropbox. Backups of your highlights will be made daily.");
		let authUrl = await dbxAuth.getAuthenticationUrl(DROPBOX_REDIRECT_URL, undefined, 'code', 'offline', undefined, undefined, true);
		highlightsBackup.codeVerifier = dbxAuth.codeVerifier;
		highlightsBackup.redirect = "https://www.ejustice.just.fgov.be/loi/loi.htm";
		await setStorage("highlightsBackup", highlightsBackup);
		chrome.tabs.create({
			url: authUrl
		});
	}
}

async function exportAllHighlights() {
	let data = await getAllHighlights({pretty: true});
	getDownload()(data, "Exported highlights.json", "application/json");
}

async function populateListOfStoredActs() {
	async function clearStorage (event) {
		let act = event.target.closest("tr").querySelector("td:nth-child(2) a");
		let proceed = confirm("Press OK to remove from the offline database " + act.innerText + ". Highlights will not be affected");
		if (proceed) {
			let eli = act.href;
			await clearActArchives(eli);
			await chrome.storage.local.remove(eli);
			// Clear text content in database
			let listOfActs = await getStorage("updateInfo");
			delete listOfActs[eli];
			await setStorage("updateInfo", listOfActs);
			let numac2eli = await getStorage("numac2eli");
			delete numac2eli[eli];
			await setStorage("numac2eli", numac2eli);
			// Clear case-law fetch flag to allow re-check
			await setStorage("caselaw-fetch-" + eli, null);
			await setStorage("caselaw-" + eli, null);
			// Clear highlights in database
			// await setStorage("highlights-" + eli, "");
			// Remove from popup list of acts
			event.target.parentElement.parentElement.parentElement.remove();
			await searchChange();
		}
	}
	// Get list of stored acts
	let listOfActs = await getStorage("updateInfo") || {};
	// Turn it into an array
	let arrayOfActs = [];
	for (const key in listOfActs) {
		let act = listOfActs[key];
		act.eli = key;
		arrayOfActs.push(act);
	}
	// Sort array by act date
	arrayOfActs = arrayOfActs.sort((a, b) => a.date?.localeCompare(b.date));
	// Display table
	document.querySelector("div#storedActs").replaceChildren(buildStoredActsControls(arrayOfActs));
	document.querySelectorAll("a.clear").forEach(el => el.addEventListener("click", runPopupCommand(clearStorage)));
	document.querySelector("input#search").addEventListener("input", searchChange);
	document.querySelector("form#storedActsSearch").addEventListener("submit", runPopupCommand(launchJustelSearch));
	document.querySelector("button#searchJustel").addEventListener("click", runPopupCommand(launchJustelSearch));
	document.querySelector("a#clearSearch").addEventListener("click", runPopupCommand(async () => {
		document.querySelector("input#search").value = "";
		await searchChange();
	}));
	await searchChange();
}

function buildStoredActsControls(arrayOfActs) {
	const fragment = document.createDocumentFragment();
	const form = document.createElement("form");
	form.id = "storedActsSearch";
	form.autocomplete = "off";
	const search = document.createElement("input");
	search.id = "search";
	search.placeholder = "Filter stored acts or search Justel";
	search.setAttribute("aria-label", "Filter stored acts or search Justel");
	search.autocomplete = "off";
	search.autofocus = true;
	const clearSearch = document.createElement("a");
	clearSearch.id = "clearSearch";
	clearSearch.href = "#";
	clearSearch.style.display = "none";
	clearSearch.textContent = "x";
	form.append(search, clearSearch);
	fragment.appendChild(form);

	const table = document.createElement("table");
	const thead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	for (const label of ["Date", "Title", "Clear"]) {
		const th = document.createElement("th");
		th.textContent = label;
		headerRow.appendChild(th);
	}
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	arrayOfActs.forEach(el => {
		const row = document.createElement("tr");
		const date = document.createElement("td");
		date.textContent = el.date || "";
		const title = document.createElement("td");
		const link = document.createElement("a");
		link.href = el.eli;
		link.target = "_blank";
		link.textContent = el.fullTitle ? el.fullTitle : el.number;
		title.appendChild(link);
		const clear = document.createElement("td");
		const clearLink = document.createElement("a");
		clearLink.className = "clear";
		clearLink.href = "#";
		const img = document.createElement("img");
		img.src = chrome.runtime.getURL("images/trash.png");
		clearLink.appendChild(img);
		clear.appendChild(clearLink);
		row.append(date, title, clear);
		tbody.appendChild(row);
	});
	table.appendChild(tbody);
	fragment.appendChild(table);
	return fragment;
}

async function searchChange(e) {
	// Search for each term separated by a space
	const searchInput = document.querySelector("input#search");
	const searchValue = searchInput.value;
	document.querySelector("a#clearSearch").style.display = searchValue ? "block" : "none";
	// Easter egg: reveal case law section (only when not already enabled)
	const searchVal = searchValue.toLowerCase().trim();
	const caselawCurrentlyEnabled = await getStorage("caselawEnabled");
	if (!caselawCurrentlyEnabled) {
		document.querySelector("div#caselawSection").style.display = searchVal === "enable beta testing" ? "block" : "none";
	}
	let somethingFound = false;
	const rows = document.querySelectorAll("tbody > tr");
	const terms = searchVal.split(/\s+/).filter(Boolean);
	rows.forEach(tr => {
		const act = `${tr.querySelector("td:first-child").textContent} ${tr.querySelector("td:nth-child(2) a").textContent}`.toLowerCase();
		if (!terms.length || terms.every(term => act.includes(term))) {
			somethingFound = true;
			tr.style.display = "table-row";
		}
		else {
			tr.style.display = "none";
		}
	});
	if (somethingFound) {
		document.querySelector("thead > tr").style.display = "table-row";
		document.querySelector("table").style.display = "table";
		document.querySelector("div#noStoredActs").style.display = "none";
	}
	else {
		document.querySelector("thead > tr").style.display = "none";
		document.querySelector("table").style.display = "none";
		document.querySelector("div#noStoredActs").style.display = "block";
		updateJustelSearchState(searchValue, rows.length > 0);
	}
}

async function toggleCaseLaw() {
	const enabled = await getStorage("caselawEnabled");
	if (enabled) {
		let choice = confirm("Press OK to disable case law abstracts. To re-enable, you will need to go through the agreement process again.");
		if (choice) {
			await setStorage("caselawEnabled", false);
			updateCaselawLink(false);
			document.querySelector("div#caselawSection").style.display = "none";
		}
	}
	else {
		chrome.tabs.create({ url: chrome.runtime.getURL("html/caselaw-agreement.html") });
	}
}

function updateCaselawLink(enabled) {
	const link = document.querySelector("a#toggleCaseLaw");
	if (!link) return;
	link.textContent = enabled ? "Disable case law abstracts (EXPERIMENTAL)" : "Enable case law abstracts (EXPERIMENTAL)";
	// Always show the section when enabled so the user can disable it without the easter egg
	if (enabled) {
		document.querySelector("div#caselawSection").style.display = "block";
	}
}

// Main
const fastOfflineBrowsing = document.querySelector("input#fastOfflineBrowsing");
const fastOfflineBrowsingStored = (await getStorage("fastOfflineBrowsing")) === true;
const hasWebNavigationPermission = await chrome.permissions.contains({permissions: ["webNavigation"]});
fastOfflineBrowsing.checked = fastOfflineBrowsingStored && hasWebNavigationPermission;
if (fastOfflineBrowsingStored && !hasWebNavigationPermission) {
	await setStorage("fastOfflineBrowsing", false);
}
fastOfflineBrowsing.addEventListener("change", async function() {
	const enabling = fastOfflineBrowsing.checked;
	try {
		if (enabling) {
			const granted = await chrome.permissions.request({permissions: ["webNavigation"]});
			if (!granted) {
				fastOfflineBrowsing.checked = false;
				await setStorage("fastOfflineBrowsing", false);
				return;
			}
		}
		await setStorage("fastOfflineBrowsing", enabling);
	}
	catch (e) {
		fastOfflineBrowsing.checked = !enabling;
		console.error(e);
		alert(e.message || "The setting could not be saved");
	}
});

let highlightsBackup = await getStorage("highlightsBackup") || {};
if (highlightsBackup.accessToken) {
	document.querySelector("a#toggleDropboxBackup").innerText = "Disable Dropbox backup of highlights";
}


document.querySelector("a#importHighlights").addEventListener("click", runPopupCommand(importHighlights));
document.querySelector("a#toggleDropboxBackup").addEventListener("click", runPopupCommand(toggleDropboxBackup));
document.querySelector("a#exportAllHighlights").addEventListener("click", runPopupCommand(exportAllHighlights));

document.querySelector("span#version").innerText = chrome.runtime.getManifest().version;

// Initialize case law link text based on current enabled state
const caselawEnabled = await getStorage("caselawEnabled");
updateCaselawLink(caselawEnabled);
document.querySelector("a#toggleCaseLaw").addEventListener("click", runPopupCommand(toggleCaseLaw));

populateListOfStoredActs();
