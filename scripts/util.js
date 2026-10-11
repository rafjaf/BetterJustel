export async function getStorage(key) {
	let items = await chrome.storage.local.get(key);
	try {
		return(items[key]);
	}
	catch(e) {
		console.error(`Error getting key ${key} from local storage:`, e);
		return undefined;
	}
}

export async function setStorage(key, value) {
	let obj = {};
	obj[key] = value;
	try {	
		return await chrome.storage.local.set(obj)
	}
	catch(e) {
		console.error(`Error storing value ${value} of key ${key} in local storage:`, e);
		return undefined;
	}
}

export async function getAllHighlights(options = {}) {
	let data = {};
	let allStorage = await chrome.storage.local.get(null);
	for (const key in allStorage) {
		if (key.startsWith("highlights-")) {
			data[key] = allStorage[key];
		}
	}
	return JSON.stringify(data, null, options.pretty ? 2 : 0);
}

export async function requestDataCollectionPermissions(dataTypes) {
	if (!globalThis.browser?.permissions) {
		return true;
	}

	const permissions = await browser.permissions.getAll();
	if (!Object.prototype.hasOwnProperty.call(permissions, "data_collection")) {
		return true;
	}

	const granted = permissions.data_collection || [];
	const missing = dataTypes.filter(dataType => !granted.includes(dataType));
	if (!missing.length) {
		return true;
	}

	return browser.permissions.request({ data_collection: missing });
}

// Store archives in the same extension-local database as current acts.
export async function clearActArchives(eli) {
	const prefix = "archive-" + eli + ":";
	// Invalidate in-flight downloads in open tabs before removing saved pages.
	await chrome.storage.local.set({["archive-reset-" + eli]: Date.now()});
	const storage = await chrome.storage.local.get(null);
	await chrome.storage.local.remove(Object.keys(storage).filter(key => key.startsWith(prefix)));
}
