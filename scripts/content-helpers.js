window.BJ = window.BJ || {};
window.BJ.helpersModule = function() {

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

	function showStatusMessage(msg) {
		// Create the popup element
		const popup = document.getElementById('status');
		popup.innerHTML = msg;

		// Show the popup
		popup.style.transform = 'translateY(0)';
		popup.style.opacity = '1';

		// After 5 seconds, hide the popup
		setTimeout(() => {
			popup.style.transform = 'translateY(100%)';
			popup.style.opacity = '0';
		}, 10000);
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

	return { delay, showStatusMessage, findObjectById, addLoading };
};
