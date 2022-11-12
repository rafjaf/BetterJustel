chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
	if (tab.url && tab.url.startsWith("https://www.ejustice.just.fgov.be/eli") && (changeInfo.status == "complete")
		&& (navigator.onLine == false)) {
		await chrome.tabs.update(tabId, {url: chrome.runtime.getURL("html/offline.html?eli=" + tab.url)});
	}
});
