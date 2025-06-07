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
