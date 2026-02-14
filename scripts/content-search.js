window.BJ = window.BJ || {};
window.BJ.searchModule = function() {

	function researchPage() {
		// Add buttons next to Nature juridique label
		let newDiv = document.createElement('div');
		newDiv.style.display = "flex";
		newDiv.style.flexDirection = "row";
		let label = document.querySelector("label[for=juridische_aard]");
		label.parentNode.insertBefore(newDiv, label);
		newDiv.appendChild(label);
		let buttonLoi = document.createElement('button');
		buttonLoi.style.position = "relative";
		buttonLoi.style.top = "-8px";
		buttonLoi.style.marginLeft = "20px";
		buttonLoi.textContent = "Loi";
		buttonLoi.addEventListener("click", function(event) {
			event.preventDefault();
			document.querySelector("select#juridische_aard").value = "LOI";
		});
		newDiv.appendChild(buttonLoi);
		let buttonAR = document.createElement('button');
		buttonAR.style.position = "relative";
		buttonAR.style.top = "-8px";
		buttonAR.style.marginLeft = "20px";
		buttonAR.textContent = "AR";
		buttonAR.addEventListener("click", function(event) {
			event.preventDefault();
			document.querySelector("select#juridische_aard").value = "ARRETE ROYAL";
		});
		newDiv.appendChild(buttonAR);
		let buttonTraite = document.createElement('button');
		buttonTraite.style.position = "relative";
		buttonTraite.style.top = "-8px";
		buttonTraite.style.marginLeft = "20px";
		buttonTraite.textContent = "Traité";
		buttonTraite.addEventListener("click", function(event) {
			event.preventDefault();
			document.querySelector("select#juridische_aard").value = "TRAITE";
		});
		newDiv.appendChild(buttonTraite);
		// Swap promulgation and publication fields (more logical to have promulgation first)
		document.querySelector("div.search-form").insertBefore(
			document.querySelector("div.search-form div:nth-of-type(6)"), 
			document.querySelector("div.search-form div:nth-of-type(5)"));
		// Search in title of the act by default
		document.querySelector("input#titel").checked = true;
	}

	function processResultsPage() {
		if (document.readyState == "complete") {
			// Change target of each link to a new tab
			document.querySelectorAll("div.list a[href]").forEach(a => a.target = "_blank");
		}
		else {
			document.addEventListener("DOMContentLoaded", processResultsPage);
		}
	}

	return { researchPage, processResultsPage };
};
