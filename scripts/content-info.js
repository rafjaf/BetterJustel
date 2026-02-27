window.BJ = window.BJ || {};
window.BJ.infoModule = function(ctx) {

	async function analyseFirstInfo() {
		console.log(`[Better Justel] analyseFirstInfo() started (readyState: "${document.readyState}")`);
		// Capture numac of the act from the top of the page
		ctx.act.numac = document.querySelector("div#list-title-1 span.tag")?.textContent;
		let _numacWaitMs = 0;
		while (!ctx.act.numac) {  
			ctx.addLoading("Checking Justel server for an updated version of the page");
			await ctx.delay(500);
			_numacWaitMs += 500;
			ctx.act.numac = document.querySelector("div#list-title-1 span.tag")?.textContent;
			if (_numacWaitMs % 5000 === 0) {
				console.warn(`[Better Justel] Still waiting for numac after ${_numacWaitMs / 1000}s (readyState: "${document.readyState}", ` +
					`body children: ${document.body?.children?.length || 0}, title-1 exists: ${!!document.querySelector("div#list-title-1")})`);
			}
			if (_numacWaitMs >= 30000) {
				console.error("[Better Justel] Timeout waiting for numac after 30s — forcing reload");
				window.location.reload();
				return;
			}
		}
		console.log(`[Better Justel] Numac found: ${ctx.act.numac} (after ${_numacWaitMs}ms)`);
		// Check if ELI can be determined from numac
		if (ctx.numac2eli[ctx.act.numac]) {
			ctx.act.eli = ctx.numac2eli[ctx.act.numac];
			if (ctx.act.eli.match(/numac/)) {
				ctx.act.type = "traité";
			}
		}
		else {
			// We must wait for the full page to load (eli should be at the end)
			ctx.addLoading("Loading page from Justel server");
			ctx.act.eli = document.querySelector("a#link-text")?.href;
			let _loadWaitMs = 0;
			while (!ctx.act.eli) {
				await ctx.delay(500);
				_loadWaitMs += 500;
				ctx.act.eli = document.querySelector("a#link-text")?.href;
				if (ctx.act.eli) break;
				// Exit if the page is fully loaded and we have given it a 2-second grace period
				// (handles non-ELI pages where a#link-text genuinely never appears)
				if (document.readyState === "complete" && _loadWaitMs >= 2000) {
					console.log(`[Better Justel] Page fully loaded after ${_loadWaitMs / 1000}s, ELI not found  — treating as non-ELI page.`);
					break;
				}
				if (_loadWaitMs % 5000 === 0) {
					console.warn(`[Better Justel] Still waiting for ELI link after ${_loadWaitMs / 1000}s (readyState: "${document.readyState}")`);
				}
				if (_loadWaitMs === 20000) {
					console.error("[Better Justel] Page appears stuck. Offering reload to user.");
					ctx.addLoading("Loading page from Justel server"
						+ " &mdash; the server is taking a long time."
						+ " <a href='javascript:window.location.reload()'>Reload</a>");
				}
				if (_loadWaitMs >= 60000) {
					console.error(`[Better Justel] Timeout after ${_loadWaitMs / 1000}s waiting for ELI — giving up.`);
					break;
				}
			}
			if (!ctx.act.eli) {
				// eli cannot be determined, used numac instead
				ctx.act.eli = "https://www.ejustice.just.fgov.be/cgi_loi/article.pl?language=fr&numac_search=" + ctx.act.numac;
				ctx.act.type = "traité";
			}
			// Save ELI in numac2eli database
			ctx.numac2eli[ctx.act.numac] = ctx.act.eli;
			await ctx.setStorage("numac2eli", ctx.numac2eli);
		}
		// Get act type, date and title
		if (ctx.act.type == "traité") {
			// Treaties may have letters in the numac (e.g. 2007A15042), so positional slicing is unreliable.
			// Try to extract the date from "Dossier numéro" / "Dossiernummer" in the info section.
			const plainText = document.querySelector("div#list-title-1 div.plain-text")?.textContent || "";
			const dossierMatch = plainText.match(/Dossier\s*num[ée]ro\s*[:/]\s*(\d{4}-\d{2}-\d{2})/i)
				|| plainText.match(/Dossiernummer\s*[:/]\s*(\d{4}-\d{2}-\d{2})/i);
			if (dossierMatch) {
				ctx.act.date = dossierMatch[1];
			} else {
				// Fallback: extract date from the title text (e.g. "22 NOVEMBRE 1984")
				const MONTHS_UC = {JANVIER:"01",FEVRIER:"02",MARS:"03",AVRIL:"04",MAI:"05",JUIN:"06",
					JUILLET:"07",AOUT:"08",SEPTEMBRE:"09",OCTOBRE:"10",NOVEMBRE:"11",DECEMBRE:"12"};
				const titleText = document.querySelector("div#list-title-1 p.list-item--title")?.textContent || "";
				const dateMatch = titleText.match(/(\d{1,2})\s+(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+(\d{4})/i);
				if (dateMatch) {
					ctx.act.date = `${dateMatch[3]}-${MONTHS_UC[dateMatch[2].toUpperCase()]}-${dateMatch[1].padStart(2, "0")}`;
				} else {
					// Ultimate fallback: strip non-digits from numac and try positional slicing
					const digits = ctx.act.numac.replace(/[^0-9]/g, "");
					ctx.act.date = digits.slice(0,4) + "-" + digits.slice(4,6) + "-" + digits.slice(6,8);
				}
			}
			console.log(`[Better Justel] Treaty date resolved: ${ctx.act.date} (numac: ${ctx.act.numac})`);
		}
		else {
			ctx.act.type = ctx.act.eli.split("/")[4];
			ctx.act.date = ctx.act.eli.split("/").slice(5,8).join("-");
		}
		let title = document.querySelector("div#list-title-1 p.list-item--title")
			.textContent.replace(/\(.+/, "")
			.split("-").slice(1).join("-").trim().split(" ");
		if (title[0] != "CODE" && ctx.act.type != "traité") {
			// Remove the first word only for regular acts (it repeats the act type, e.g. "Loi")
			// For treaties the first word is part of the actual title (e.g. "Protocole")
			title = title.slice(1);
		}
		title = title.join(" ");
		if (ctx.act.type == "traité" && title.match(/COLLECTIVE/)) { ctx.act.type = "cct" }
		ctx.act.fullTitle = `${ctx.act.type.slice(0,1).toUpperCase()}. ${ctx.act.date} ${title}`;
		ctx.act.lastUpdate = document.querySelector("div#list-title-1 p.list-item--title")
						 .textContent.split("mise à jour au")?.[1]?.match(/(\d{2})-(\d{2})-(\d{4})/)
						 ?.slice(1)?.reverse()?.join("-")
						 || ctx.act.date;
	}

	function analyseFurtherInfo() {
		// Original and consolidated PDF
		let originalPDF = Array.from(document.querySelectorAll("div.links-box a")).filter(a => a.href.indexOf("/mopdf") > -1)[0]?.href;
		let consolidatedPDF = Array.from(document.querySelectorAll("div.links-box a")).filter(a => a.href.indexOf("/img_l/pdf") > -1)[0]?.href;
		// Preamble and Report to the King ?
		let preamble = document.querySelector("div#list-title-sw_prev");
		let report = document.querySelector("div#list-title-sw_roi");
		let heading = {}, article = {};
		heading.id = "visas";
		heading.type = "visas";
		heading.level = "level1";
		heading.text = "Visas";
		heading.content = "Visas";
		heading.children = [];
		if (preamble && (ctx.act.type != "loi")) {
			let preambleContent = preamble.innerHTML;
			heading.children.push({id: "preamble0", type: "article", level: "article", text: "Préambule", content: preambleContent});
		}
		if (report) {
			let reportContent = report.innerHTML;
			heading.children.push({id: "report000", type: "article", level: "article", text: "Rapport au Roi", content: reportContent});
		}
		if (heading.children.length) {
			ctx.headingsWhoseTypeNeedsToBeDefined.push(heading);
			ctx.act.content.push(heading);
		}
		// General information on the act
		// Remove numac tag
		document.querySelector("div#list-title-1 span.tag").remove();
		// Separate title of the act from additional notes and the last update date
		document.querySelector("div#list-title-1 p.list-item--title").innerHTML
			= document.querySelector("div#list-title-1 p.list-item--title").innerHTML
			  .replace(/(\s+)?(.+?)(\(NOTE.+)/, "<span class='title'>$2</span>$3")
			  .replace(/(mise à jour au \d{2}-\d{2}-\d{4})/, "<span class='update'>$1</span>")
			  .replace(/(annulé)/, "<span class='update'>$1</span>");
		if (!document.querySelector("div#list-title-1 p.list-item--title").innerHTML.match(/NOTE/)) {
			document.querySelector("div#list-title-1 p.list-item--title").innerHTML
			= "<span class='title'>" + document.querySelector("div#list-title-1 p.list-item--title").innerHTML + "</span>";
		}
		// Make sure links open in a new page
		Array.from(document.querySelectorAll("div#list-title-1 div.plain-text a")).forEach(a => a.target = "_blank");
		ctx.act.info = document.querySelector("div#list-title-1 div.list-item--content").innerHTML
			.replace(/<p>/g, "<span>").replace(/<\/p>/g, "</span>");
		let additionalInfo = [];
		additionalInfo.push(`<a href='${ctx.act.eli}' target="_blank">ELI</a>`);
		if (originalPDF) { additionalInfo.push(`<a href='${originalPDF}' target="_blank">Moniteur belge</a>`); }
		if (consolidatedPDF) { 
			additionalInfo.push(`<a href='${consolidatedPDF}' target="_blank">PDF consolidé</a>`);
			additionalInfo.push(`<a id='btnSavePDF'><img src='${chrome.runtime.getURL("images/save.png")}'></a>`);
		}
		if (document.querySelector("div.external-links")) {
			document.querySelectorAll("div.external-links a").forEach(a => additionalInfo.push(a.outerHTML));
		}
		// Dutch version link
		let nlLink = Array.from(document.querySelectorAll("nav a")).find(a => a.textContent.trim() === "NL")?.href;
		if (nlLink) {
			additionalInfo.push(`<a href='${nlLink}' target="_blank">NL</a>`);
		}
		additionalInfo.push(`<a id='clearDB' href='#'>Clear storage</a>`);
		additionalInfo.push(`<a href="${window.location.origin + window.location.pathname}`
							+`${window.location.search ? window.location.search + "&" : "?"}noJS=true" target="_blank">Original Justel</a></b>`);
		ctx.act.info += "<div id='addinfodiv'>" + additionalInfo.map(el => `<span>${el}</span>`).join("") + "</div>";
	}

	return { analyseFirstInfo, analyseFurtherInfo };
};
