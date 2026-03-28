import { setStorage } from "./util.js";

// Load the GPL license text from the extension's LICENSE file
try {
	const resp = await fetch(chrome.runtime.getURL("LICENSE"));
	const text = await resp.text();
	document.querySelector("#licenseText").textContent = text;
	document.querySelector("#downloadLicenseBtn").addEventListener("click", () => {
		const blob = new Blob([text], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "LICENSE.txt";
		a.click();
		URL.revokeObjectURL(url);
	});
} catch (e) {
	document.querySelector("#licenseText").textContent = "(Unable to load license text.)";
	console.error("[Better Justel] Failed to load LICENSE:", e);
}

const cb1 = document.querySelector("#cb1");
const cb2 = document.querySelector("#cb2");
const cb3 = document.querySelector("#cb3");
const enableBtn = document.querySelector("#enableBtn");

function updateButton() {
	enableBtn.disabled = !(cb1.checked && cb2.checked && cb3.checked);
}

cb1.addEventListener("change", updateButton);
cb2.addEventListener("change", updateButton);
cb3.addEventListener("change", updateButton);

enableBtn.addEventListener("click", async () => {
	const granted = await chrome.permissions.request({
		origins: ["https://raw.githubusercontent.com/rafjaf/juportal_crawler/main/data/*"]
	});
	if (!granted) {
		alert("Permission was not granted. Case law will not be displayed until you grant access to raw.githubusercontent.com.");
		return;
	}
	await setStorage("caselawEnabled", true);
	window.close();
});
