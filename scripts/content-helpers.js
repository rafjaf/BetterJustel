window.BJ = window.BJ || {};
window.BJ.helpersModule = function() {
	const statusTimers = new WeakMap();

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

	function showStatusMessage(msg, duration = 10000) {
		const container = document.getElementById('status');
		const item = document.createElement('div');
		item.classList.add('status-item');
		appendStatusMessage(item, msg);
		container.appendChild(item);

		// Trigger slide-in after two animation frames so the transition fires
		requestAnimationFrame(() => requestAnimationFrame(() => {
			item.style.transform = 'translateY(0)';
			item.style.opacity = '1';
		}));

		if (duration > 0) { scheduleStatusRemoval(item, duration); }
		return item;
	}

	function updateStatusMessage(item, msg, duration = 10000) {
		if (!item?.isConnected) { return showStatusMessage(msg, duration); }
		const oldTimer = statusTimers.get(item);
		if (oldTimer) { clearTimeout(oldTimer); }
		item.replaceChildren();
		appendStatusMessage(item, msg);
		if (duration > 0) { scheduleStatusRemoval(item, duration); }
		return item;
	}

	function scheduleStatusRemoval(item, duration) {
		const timer = setTimeout(() => {
			item.style.transform = 'translateY(100%)';
			item.style.opacity = '0';
			setTimeout(() => item.remove(), 1000);
		}, duration);
		statusTimers.set(item, timer);
	}

	function appendStatusMessage(container, msg) {
		const doc = new DOMParser().parseFromString(String(msg || ""), "text/html");
		for (const node of doc.body.childNodes) {
			appendSanitizedNode(container, node);
		}
	}

	function appendSanitizedNode(container, node) {
		if (node.nodeType == Node.TEXT_NODE) {
			container.appendChild(document.createTextNode(node.textContent));
			return;
		}
		if (node.nodeType != Node.ELEMENT_NODE) {
			return;
		}
		if (node.tagName == "A") {
			const a = document.createElement("a");
			const href = node.getAttribute("href") || "";
			if (/^(https?:|moz-extension:|chrome-extension:)/i.test(href)) {
				a.href = href;
			}
			a.target = node.getAttribute("target") || "_blank";
			a.textContent = node.textContent;
			container.appendChild(a);
			return;
		}
		container.appendChild(document.createTextNode(node.textContent));
	}

	function findObjectById(obj, id) {
	  // Check if the current object has the desired ID
	  if (obj && obj.id === id) {
		return obj;
	  }

	  // Iterate over each key in the current object
	  for (const key in obj) {
		// Check if the current key's value is an object
		if (typeof obj[key] === 'object' && obj[key] !== null) {
		  // Recursively search for the ID in the nested object
		  const result = findObjectById(obj[key], id);

		  // If the ID is found, return the result
		  if (result) {
			return result;
		  }
		}
	  }	  
	  // Return null if the ID is not found
	  return null;
	}

	function addLoading(msg) {
		if(!document.querySelector("div#loading")) {
			$("head").append("<style>div.page, div.page__wrapper--content, footer {display: none;}</style>");			
			$("body").prepend(`<div id='loading'><div class="loadingio-spinner-spinner-is7uuvdj549"><div class="ldio-zrg2ss6p6ee">`
				+`<div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>`
				+`<div></div><div></div><div></div></div></div><span id='msg'>${msg}</span></div>`);
		}
		else {
			document.querySelector("div#loading span#msg").textContent = msg;
		}
	}

	return { delay, showStatusMessage, updateStatusMessage, findObjectById, addLoading };
};
