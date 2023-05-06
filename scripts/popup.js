const DROPBOX_CLIENT_ID = "bxh6gtfvn361dbe";
const DROPBOX_REDIRECT_URL = "https://www.ejustice.just.fgov.be/eli/";

import {getStorage, setStorage, getAllHighlights} from "../scripts/util.js";

async function importHighlights() {
	// Input box to import highlights
	let input = prompt("Please paste highlights to be imported");
	// Verifications
	if (!input) {return;}
	let inputObj
	try {
		inputObj = JSON.parse(input);
	}
	catch(e) {
		alert("Invalid JSON");
		return;
	}
	// Save imported highlights
	let counter = 0;
	for (const key in inputObj) {
		if (key.startsWith("highlights-")) {
			await setStorage(key, inputObj[key]);
			counter += 1;
		}
	}
	// Save new highlights
	alert(`Imported highlights for ${counter} acts`);
}

async function toggleDropboxBackup() {
	let highlightsBackup = await getStorage("highlightsBackup") || {};
	if (highlightsBackup.accessToken) {
		let choice = confirm("Press OK to disable Dropbox backup of highlights");
		if (choice) {
			highlightsBackup = {};
			await setStorage("highlightsBackup", highlightsBackup);
		}
	}
	else {
		let dbxAuth = new Dropbox.DropboxAuth({
			clientId: DROPBOX_CLIENT_ID,
		});
		highlightsBackup.filename = prompt("Please enter the file name of backups", "Highlights Backup");
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
	let data = await getAllHighlights();
	download(data, "Exported highlights.json", "application/json");
}

async function populateListOfStoredActs() {
	async function clearStorage (event) {
		let eli = event.target.parentElement.parentElement.parentElement.children[1].children[0].href;
		let listOfActs = await getStorage("updateInfo");
		delete listOfActs[eli];
		await setStorage("updateInfo", listOfActs);
		event.target.parentElement.parentElement.parentElement.remove();
	}
	// Get list of stored acts
	let listOfActs = await getStorage("updateInfo");
	// Exit if no store acts
	if (!listOfActs) {return;}
	// Turn it into an array
	let arrayOfActs = [];
	for (const key in listOfActs) {
		let act = listOfActs[key];
		act.eli = key;
		arrayOfActs.push(act);
	}
	// Sort array by act date
	arrayOfActs = arrayOfActs.sort((a, b) => a.date?.localeCompare(b.date));
	// Build a table of acts
	let table = "<form autocomplete='off'><input id='search' placeholder='Type text to filter acts' autocomplete='off' autofocus><a id='clearSearch' style='display: none;'>x</a></form>"
				+"<table><thead><tr><th>Date</th><th>Title</th><th>Clear</th></tr></thead><tbody>";
	arrayOfActs.forEach(el => {
		table += `<tr><td>${el.date}</td><td><a href="${el.eli}" target="_blank">${el.fullTitle ? el.fullTitle : el.number}</a></td><td><a class="clear" href="#"><img src="${chrome.runtime.getURL("images/trash.png")}"></a></td></tr>`;
	});
	table += "</tbody></table>";
	// Display table
	document.querySelector("div#noStoredActs").style.display = "none";
	document.querySelector("div#storedActs").innerHTML = table;
	document.querySelectorAll("a.clear").forEach(el => el.addEventListener("click", clearStorage));
	document.querySelector("input#search").addEventListener("input", searchChange);
	document.querySelector("a#clearSearch").addEventListener("click", () => {
		document.querySelector("input#search").value = "";
		searchChange();
	});
}

function searchChange(e) {
	// Search for each term separated by a spac"
	document.querySelector("a#clearSearch").style.display = document.querySelector("input#search").value ? "block" : "none";
	let somethingFound = false;
	document.querySelectorAll("tbody > tr").forEach(tr => {
		let act = tr.querySelector("a").text.toLowerCase();
		if (!document.querySelector("input#search").value || document.querySelector("input#search").value.split(" ").every(el => act.indexOf(el.toLowerCase()) >= 0)) {
			somethingFound = true;
			tr.style.display = "table-row";
		}
		else {
			tr.style.display = "none";
		}
	});
	if (somethingFound) {
		document.querySelector("thead > tr").style.display = "table-row";
		document.querySelector("div#noStoredActs").style.display = "none";
	}
	else {
		document.querySelector("thead > tr").style.display = "none";
		document.querySelector("div#noStoredActs").style.display = "block";
	}
}

// Main
document.querySelector("a#importHighlights").addEventListener("click", importHighlights);
document.querySelector("a#toggleDropboxBackup").addEventListener("click", toggleDropboxBackup);
document.querySelector("a#exportAllHighlights").addEventListener("click", exportAllHighlights);

document.querySelector("span#version").innerText = chrome.runtime.getManifest().version;

populateListOfStoredActs();

