const JUSTEL_ORIGIN = "https://www.ejustice.just.fgov.be";
const ONLINE_BYPASS_PREFIX = "online-bypass-";
const ONLINE_BYPASS_LIFETIME_MS = 2 * 60 * 1000;
const redirectingTabs = new Set();

function cacheKeyForUrl(rawUrl) {
	try {
		const url = new URL(rawUrl);
		if (url.origin !== JUSTEL_ORIGIN) { return null; }
		if (url.searchParams.has("noJS") || url.searchParams.has("arrexec") || url.searchParams.has("arch")) {
			return null;
		}
		if (url.searchParams.has("language") && url.searchParams.get("language") !== "fr") {
			return null;
		}
		if (url.pathname.startsWith("/eli/") && url.pathname !== "/eli/") {
			if (/\/moniteur\/?$/.test(url.pathname)) { return null; }
			return url.origin + url.pathname;
		}
		if (/^\/cgi_[^/]+\/article\.pl$/.test(url.pathname)) {
			url.hash = "";
			return url.href;
		}
	}
	catch (e) {
		console.warn("[Better Justel] Invalid navigation URL:", rawUrl, e.message);
	}
	return null;
}

async function hasOnlineBypass(tabId, eli) {
	const key = ONLINE_BYPASS_PREFIX + tabId;
	const bypass = (await chrome.storage.local.get(key))[key];
	if (!bypass) { return false; }
	if (bypass.eli === eli && bypass.expiresAt > Date.now()) { return true; }
	await chrome.storage.local.remove(key);
	return false;
}

async function redirectCachedNavigation(details) {
	if (details.frameId !== 0 || redirectingTabs.has(details.tabId)) { return; }
	const eli = cacheKeyForUrl(details.url);
	if (!eli) { return; }

	redirectingTabs.add(details.tabId);
	try {
		if (await hasOnlineBypass(details.tabId, eli)) { return; }
		const storage = await chrome.storage.local.get(["updateInfo", "fastOfflineBrowsing"]);
		if (storage.fastOfflineBrowsing !== true && navigator.onLine !== false) { return; }
		const cached = (storage.updateInfo || {})[eli];
		if (!cached?.act || cached.script !== chrome.runtime.getManifest().version) { return; }

		const offlineUrl = chrome.runtime.getURL("html/offline.html") + "?eli=" + encodeURIComponent(eli);
		await chrome.tabs.update(details.tabId, {url: offlineUrl});
	}
	catch (e) {
		console.warn("[Better Justel] Could not redirect cached navigation:", e.message);
	}
	finally {
		redirectingTabs.delete(details.tabId);
	}
}

async function clearOnlineBypassAfterNavigation(details) {
	if (details.frameId !== 0 || !cacheKeyForUrl(details.url)) { return; }
	await chrome.storage.local.remove(ONLINE_BYPASS_PREFIX + details.tabId);
}

let webNavigationListenersRegistered = false;

function registerWebNavigationListeners() {
	if (webNavigationListenersRegistered || !chrome.webNavigation) { return; }
	chrome.webNavigation.onBeforeNavigate.addListener(redirectCachedNavigation);
	chrome.webNavigation.onCompleted.addListener(clearOnlineBypassAfterNavigation);
	webNavigationListenersRegistered = true;
}

function unregisterWebNavigationListeners() {
	if (!webNavigationListenersRegistered) { return; }
	if (chrome.webNavigation) {
		chrome.webNavigation.onBeforeNavigate.removeListener(redirectCachedNavigation);
		chrome.webNavigation.onCompleted.removeListener(clearOnlineBypassAfterNavigation);
	}
	webNavigationListenersRegistered = false;
}

// Register synchronously when the API is available so Manifest V3 can wake the
// service worker for navigation events after the optional permission is granted.
registerWebNavigationListeners();

chrome.permissions.onAdded.addListener(function(permissions) {
	if (permissions.permissions?.includes("webNavigation")) {
		registerWebNavigationListeners();
	}
});

chrome.permissions.onRemoved.addListener(function(permissions) {
	if (permissions.permissions?.includes("webNavigation")) {
		unregisterWebNavigationListeners();
		chrome.storage.local.set({fastOfflineBrowsing: false});
	}
});

chrome.tabs.onRemoved.addListener(async function(tabId) {
	await chrome.storage.local.remove(ONLINE_BYPASS_PREFIX + tabId);
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	if (message?.action === "refreshOnline" && typeof message.url === "string" && sender.tab?.id !== undefined) {
		const eli = cacheKeyForUrl(message.url);
		if (!eli) {
			sendResponse({ok: false, error: "Invalid Justel URL"});
			return;
		}
		const tabId = sender.tab.id;
		const key = ONLINE_BYPASS_PREFIX + tabId;
		chrome.storage.local.set({
			[key]: {eli, expiresAt: Date.now() + ONLINE_BYPASS_LIFETIME_MS},
		}).then(() => {
			sendResponse({ok: true});
			return chrome.tabs.update(tabId, {url: eli});
		}).catch(e => {
			sendResponse({ok: false, error: e.message});
		});
		return true;
	}

	if (message?.action === "openUrl" && typeof message.url === "string") {
		let url = new URL(message.url);
		if (["file:", "http:", "https:", "ftp:"].includes(url.protocol)) {
			chrome.tabs.create({ url: message.url });
		}
	}
});
