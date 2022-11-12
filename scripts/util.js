export async function getStorage(key) {
	let items = await chrome.storage.local.get(key);
	return(items?.[key]);
}

export async function setStorage(key, value) {
	let obj = {};
	obj[key] = value;	
	return await chrome.storage.local.set(obj)
}

export async function getAllHighlights() {
	let data = {};
	let allStorage = await chrome.storage.local.get(null);
	for (const key in allStorage) {
		if (key.startsWith("highlights-")) {
			data[key] = allStorage[key];
		}
	}
	return JSON.stringify(data);
}
