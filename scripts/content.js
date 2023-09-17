(async function() {
    'use strict';

	const DROPBOX_CLIENT_ID = "bxh6gtfvn361dbe";
	const DROPBOX_REDIRECT_URL = "https://www.ejustice.just.fgov.be/eli/";
	
	const HEADINGS_TYPE = ["partie", "livre", "titre", "sous-titre", "chapitre", "section", "sous-section", "paragraphe", "§"];
	let act = {content: []}, updateInfo, highlights, currentArticle, currentRange, highlightsBackup;
	let headingsWhoseTypeNeedsToBeDefined = [];
	
	let {getStorage, setStorage, getAllHighlights} = await import(chrome.runtime.getURL('scripts/util.js'));

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    	
	function showStatusMessage(msg) {
		// Create the popup element
		const popup = document.getElementById('status');
		popup.textContent = msg;

		// Show the popup
		popup.style.transform = 'translateY(0)';
		popup.style.opacity = '1';

		// After 5 seconds, hide the popup
		setTimeout(() => {
			popup.style.transform = 'translateY(100%)';
			popup.style.opacity = '0';
		}, 5000);
	}

	function analyseContent() {
		// Declarations
		let currentParents = [], lastNode, counter = 1;
		// Internal function
		function analyseHeading(n) {
			let heading = {};
			heading.id = "node" + counter.toString().padStart(5, "0");
			heading.type = n.textContent.split(" ")[0].toLowerCase().trim();
			if ( !HEADINGS_TYPE.some(el => el == heading.type) ) {
				if (heading.type.startsWith("disposition") || !n?.nextElementSibling?.nextElementSibling
				   || n?.nextElementSibling?.nextSibling?.nodeName == "#text") {
					// If type is unknown, use last known type
					// If this is the first heading, then remember to set it later
					if (currentParents.length) {
						heading.type = currentParents.slice(-1)[0].type;
					}
					else {
						headingsWhoseTypeNeedsToBeDefined.push(heading);
					}
				}
				else {
					// Let's assume it is not a heading but the title of next article
					// Let's remove useless <br>
					// console.log(n, n.nextElementSibling);
					n.nextElementSibling.remove();
					n.nextElementSibling.remove();
					let t = n.nextElementSibling.nextElementSibling.textContent + ". " + n.textContent;
					t = t.slice(-1) == "." ? t.slice(0, -1) : t;
					let oldT = n.nextElementSibling.nextElementSibling.textContent;
					n.nextElementSibling.nextElementSibling.textContent = t;
					n.nextElementSibling.nextElementSibling.nextSibling.textContent = n.nextElementSibling.nextElementSibling.nextSibling.textContent.replace(/^\.\s?/, "");
					$(n).next().next().attr("addBr", "true");
					return;
				}
			}
			else if (headingsWhoseTypeNeedsToBeDefined.length) {
				for (let h of headingsWhoseTypeNeedsToBeDefined) {
					h.type = heading.type;
				}
				headingsWhoseTypeNeedsToBeDefined = [];
			}
			heading.text = n.textContent.trimStart();
			heading.content = n.textContent;
			heading.titleOngoing = false;
			heading.children = [];
			if (!currentParents.length) {
				// Node must be directly attached to root
				act.content.push(heading);
				currentParents.push(heading);
			}
			else {
				// Other parents have already been analysed
				let currentHeadingLevel = HEADINGS_TYPE.indexOf(heading.type);
				let parentHeadingLevel = HEADINGS_TYPE.indexOf(currentParents.slice(-1)[0].type);
				if ( currentHeadingLevel > parentHeadingLevel ) {
					// Current node is at a lower level than last parent
					currentParents.slice(-1)[0].children.push(heading);
					currentParents.push(heading);
				}
				else if (currentHeadingLevel == parentHeadingLevel) {
					// Current node is at the same level as last parent
					currentParents.pop();
					if (!currentParents.length) {
						// We are at the highest level, hence attach to the root
						act.content.push(heading);
					}
					else {
						// We are at a lower level, hence attach to previous level
						currentParents.slice(-1)[0].children.push(heading);
					}
					currentParents.push(heading);
				}
				else {
					// Current node is at a higher level as the last parent
					// Therefore, parent nodes must be erased until reaching the same level as current node
					// console.log(n, lastNode, currentParents);
					do {
						currentParents.pop();
						if (!currentParents.length) {
							console.log("Wrong heading structure at", n);
							break;
						}
					}
					while (currentHeadingLevel < HEADINGS_TYPE.indexOf(currentParents.slice(-1)[0].type));
					currentParents.pop();
					if (!currentParents.length) {
						// We are at the highest level, hence attach to the root
						act.content.push(heading);
					}
					else {
						// We are at a lower level, hence attach to previous level
						currentParents.slice(-1)[0].children.push(heading);
					}
					currentParents.push(heading);
				}
			}
			heading.level = "level" + currentParents.length;
			lastNode = heading;
			counter += 1;
		}
		function beautify(n) {
			// Sanitize text of the node
			n.text = n.text.replace(/[\[\]]|[\(\)]|--+/g, "").replace(/\s\s/g, " ")
				.replace(/(\d+(er)?\.)([A-Z])/g, "$1 $3");
			const ARTICLE_REGEX = /Art(\.|icle)\s?[LR]?([IVX]+|\d+(\w+)?)((\.|\/|:|-)\d+)?((\.|\/|:|-)\d+)?\.(.+[a-zéè]$)?/
			let m = n.text.match(ARTICLE_REGEX);
			if (m) { n.text = m[0]; }
			// Rules depending on node type
			if (n.type == "article") {
				const INDENT_PREFIX = "^(?:<b>.+<\\/b>)?(?:\\[(<sup>.+<\\/sup>)?\\s?|\\()?";
				const INDENT_ARRAY = ["§\\s\\d+(er)?(\\/\\d+)?\.", 
									  "[IVX]+\\.\\s",
									  "\\d+(\\/\\d+)?°(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies)?",
									  "\\(?[a-hj-uwyz]\\)",
									  "[ivx]+(\\.|\\))\\s",
									  "-\\s"];
				const INDENT_TYPE = INDENT_ARRAY.map(el => new RegExp(INDENT_PREFIX + el));
				let content = n.content.split("<br>").filter(el => el).map(el => el.trim().replace(/\s\s/g, " "));
				let contentIndent = new Array(content.length);
				// For article's indent the logic is as follows:
				// 1. Loop forwards and give to each text block starting with I., 1°, a), etc. its proper indent;
				//    any text block with unindentified indent is marked with type -1
				// 2. Loop backwards and assume that any paragraph of unidentified type -1 is of the same type as the last one;
				//    that way, a paragraph can continue for several sub-paragraphs. However, this does not apply for the paragraph
				//    preceding the first of a series (thus preceding I., 1°, a), etc.) which is marked -2
				// 3. Loop again forwards and assume that paragraphs -2 are of the same type as the preceding paragraph
				// First loop:
				for (let i = 0; i < content.length; i++) {
					// Put "Art." and its title in bold
					let m = content[i].match(ARTICLE_REGEX);
					if (m) {
						content[i] = content[i].replace(ARTICLE_REGEX, "<b>$&</b>");
					}
					// Search for indent
					let t = INDENT_TYPE.findIndex(el => content[i].match(el));
					contentIndent[i] = {};
					contentIndent[i].type = t;
					if ( t > -1 ) {
						contentIndent[i].numbering = content[i].match(INDENT_TYPE[t])[0];
						content[i] = content[i].replace(INDENT_TYPE[t], "<b>$&</b>");
					}
				}
				// Second loop:
				let indent = 0;
				for (let i = content.length - 1; i > 0; i--) {
					if (contentIndent[i].type == -1) {
						contentIndent[i].type = indent
					}
					else {
						let number = contentIndent[i].numbering.match(/\d°|\w\)|-/)?.[0];
						if (number && ( number.startsWith("1") || number.startsWith("a") || number.startsWith("-") ) ) {
							indent = -2;
						}
						else {
							indent = contentIndent[i].type
						}
					}
				}
				// Third loop:
				let subparCount = 0;
				indent = 0;
				for (let i = 0; i < content.length; i++) {
					if (contentIndent[i].type == -2) {
						contentIndent[i].type = Math.max(indent, 0);
					}
					else {
						indent = contentIndent[i].type
					}
					if (content[i].startsWith("----------")) {
						subparCount = undefined;
					}
					else if (contentIndent[i].numbering?.match(/§/)) {
						subparCount = 1
					}
					else if (contentIndent[i].type == 0 || (!i && !content[i].endsWith("</b>")) ) {
						subparCount += 1;
						contentIndent[i].subparCount = subparCount;
					}
				}
				n.content = content.map((el, i) => `<div style='padding-left: ${contentIndent[i].type * 20}px;'>${contentIndent[i].subparCount > 1 ? "<span class='subpar'>Al. " + contentIndent[i].subparCount + "</span>" : ""}${el}</div>`).join("") + "<br>";
			}
			else if (n.titleOngoing) {
				// This is a heading whose title is ongoing, needs to be closed
				n.content += "</div>";
				n.content = n.content.replace("<br><br>", "");
			}
		}
		function buildLastNode(n) {
			let article = {};
			article.id = "node" + counter.toString().padStart(5, "0");
			article.type = "article";
			article.text = n.textContent;
			article.titleOngoing = true;
			article.content = n.textContent;
			article.level = "article";
			if (!currentParents.length) {
				// If there is no heading to attach the article, create a fake heading
				let heading = {}
				heading.id = "node" + (counter -1).toString().padStart(5, "0");
				heading.type = "dispositif";
				heading.text = "Dispositif";
				heading.content = "Dispositif<br><br>";
				heading.level = "level1";
				heading.children = [];
				headingsWhoseTypeNeedsToBeDefined.push(heading);
				currentParents.push(heading);
				act.content.push(heading);
			}
			return (article);
		}
		// Main analyseContent
		let contentNodes = Array.from(Array.from(document.querySelectorAll("body > table > tbody > tr:nth-child(1) > th:nth-child(1)"))
			.filter(el => el.textContent.indexOf("Texte") > -1)[0].parentElement.nextElementSibling.children[0].childNodes);
		// Correct erroneous encoding of the text
		const WRONG_LAST_NODENAME = ["ERRATUM,M.B.", "I", "BR&GT;<BR", "L"];
		while ( WRONG_LAST_NODENAME.some(el => el == contentNodes.slice(-1)[0].nodeName) ) {
			contentNodes = contentNodes.concat( Array.from( contentNodes.slice(-1)[0].childNodes ) );
		}
		// Anlyse each node depending on their type
		for (let n of contentNodes) {
			if ( (n.nodeName == "A") && (n.name) && (n.name.startsWith("LNK") && !(n.textContent.toLowerCase().startsWith("annexe")) ) ) {
				// This is a heading
				if (lastNode) { beautify(lastNode); }
				analyseHeading(n);
			}
			else if ( (n.nodeName == "A") && (n.name) && (n.name.startsWith("Art") || n.textContent.toLowerCase().startsWith("annexe") ) ) {
				// This is an article, to be attached to last heading
				if (lastNode) { beautify(lastNode); }
				lastNode = buildLastNode(n);
				currentParents.slice(-1)[0].children.push(lastNode);
				counter += 1;
			}
			else if ( (n.nodeName == "A") && n.href && lastNode) {
				if (n.target == "_blank") {
					// This is the reference of a modifying law
					lastNode.content += n.outerHTML;
				}
				else {
					// This is the second part of the article title
					lastNode.text += n.textContent;
					lastNode.content += n.textContent.replace(/</g, "&lt;");
					if (n.getAttribute("addBr")) {
						lastNode.content += "<br>";
					}
				}
			}
			else if ( ["SUP", "FONT", "I", "TABLE", "P"].some(el => el == n.nodeName) ) {
				if (!lastNode) {
					lastNode = buildLastNode(n);
					lastNode.content += n.outerHTML
					currentParents.slice(-1)[0].children.push(lastNode);
					counter += 1;
				}
				else {
					lastNode.content += n.outerHTML;
				}
			}
			else if ( (n.nodeName == "#text") && lastNode && n.textContent.trim() ) {
				// This is floating text
				let text = n.textContent; //.trim();
				if (lastNode.type == "article") {
					if (lastNode.titleOngoing) {
						// Text is part of the title of the article
						// lastNode.text += (text[0] == "." ? "" : " ") + text;
						lastNode.text += (text[0] == "." ? text : "");
						lastNode.content += n.textContent.replace(/</g, "&lt;");
					}
					else {
						// Test if a heading was erroneously inserted as the end of an article (wrong subdivision)
						if ( (text.trim()[0] != "§")
							&& ( n.nextSibling?.nextSibling?.nodeName == "BR" )
							&& ( HEADINGS_TYPE.some(el => text.toLowerCase().trim().startsWith(el)) ) ) {
							// This is a heading hidden in the article content
							lastNode.content += "<br><br>";
							beautify(lastNode);
							n.textContent = n.textContent.trim();
							analyseHeading(n);
						}
						else {
							// This is ordinary text to be added to the content of the article
							lastNode.content += n.textContent.replace(/</g, "&lt;");
						};
					}
				}
				else {
					// Last node was a heading
					// Test if a heading was erroneously inserted as the content of an heading title (wrong subdivision)
					let m = text.match(/[\w\-]+\s\d(\w+)?\.\s.+/);
					if (m && HEADINGS_TYPE.some(el => m[0].toLowerCase().startsWith(el))) {
						// There are two titles hidden in this heading
						let node = {};
						lastNode.text += " " + text.slice(0, m.index - 1);
						lastNode.content += text.slice(0, m.index - 1) + "<br><br>";
						node.textContent = m[0];
						analyseHeading(node);
					}
					else {
						// This is ordinary text to be added to the text of the heading
						lastNode.text += (text[0] == "." ? "" : " ") + text;
						lastNode.content += n.textContent;
					}
				}
			}
			else if ( (n.nodeName == "#text") && n.textContent.trim() ) {
				lastNode = buildLastNode(n);
				currentParents.slice(-1)[0].children.push(lastNode);
				counter += 1;
			}
			else if ( (n.nodeName == "BR") && lastNode ) {
				if ( (lastNode.type == "article") ) {
					// Add <br> to content
					lastNode.content += "<br>";
					if (lastNode.titleOngoing) {
						// The <br> marks the end of the title of the article
						lastNode.titleOngoing = false;
					}
				}
				else {
					// Add <br> to content
					lastNode.content += "<br>";
					if ( !lastNode.titleOngoing) {
						// The <br> marks the beginning of the ongoing part of the heading title
						lastNode.titleOngoing = true;
						lastNode.content += "<div class='nostyle'>";
					}
				}
			}
		}
		if (lastNode) {
			beautify(lastNode);
			if ( (lastNode.type == "article") && (lastNode.text == "Art.") ) {
				let correctText = lastNode.content.match(/(<div style='padding-left: -20px;'><b>)(.+)(<\/b>)/)?.[2];
				if (correctText) {
					lastNode.text = correctText;
				}
			}
		}
	}

	function buildContent(nodesArray) {
		let content = "";
		for (let n of nodesArray) {
			content += `<div id="anchor_${n.id}" class="${n.level}">${n.content}</div>`;
			if (n.children?.length) {
				content += buildContent(n.children);
			}
		}
		return content;
	}

	async function analyseFirstInfo() {
		// Capture act info (first table is missing at this stage)
		let titleTable = document.querySelectorAll("body > table")[1];
		if (!titleTable?.querySelector("tbody > tr:nth-child(3) > th > b")) {
			// Function is run too early, before page was loaded
			await delay(500);
			await analyseFirstInfo();
			return
		}
		act.eli = document.querySelectorAll("body > table")[0].querySelector("tbody > tr:nth-child(9) > td")?.textContent?.replace("http:", "https:");
		if (!act.eli) {act.eli = window.location.href.replace("http:", "https:");}
		// Act type, date and title
		act.type = act.eli.split("/")[4];
		if (act.type.indexOf("loi_a1.pl") > -1) {act.type = "traité";}
		act.date = act.eli.split("/").slice(5,8).join("-");
		if (!act.date) {
			const MONTH_FR = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout",
							  "septembre", "octobre", "novembre", "decembre"];
			let text = document.querySelectorAll("body > table")[1].querySelector("th b").innerText.toLowerCase();
			let components = text.match(/^(\d+)+\s(\w+)\s(\d+)/);
			act.date = components[3] + "-" + (MONTH_FR.indexOf(components[2]) + 1).toString().padStart(2, "0") + "-" + components[1];
		}
		act.title = titleTable.querySelector("tbody > tr:nth-child(3) > th > b")
			.firstChild.textContent.replace(/\(.+/, "")
			.split("-").slice(1).join("-").trim().split(" ");
		if (act.title[0] != "CODE") {
			act.title = act.title.slice(1);
		}
		act.title = act.title.join(" ");
		act.fullTitle = `${act.type.slice(0,1).toUpperCase()}. ${act.date} ${act.title}`;
		act.lastUpdate = titleTable.querySelector("tbody > tr:nth-child(3) > th")
						 .innerHTML.split("mise à jour au")?.[1]?.match(/(\d{2})-(\d{2})-(\d{4})/)
						 ?.slice(1)?.reverse()?.join("-")
						 || act.date;
	}

	function analyseFurtherInfo() {
		// Consolidated PDF ?
		let consolidatedPDF = Array.from(document.querySelectorAll("body > table")[1].querySelectorAll("tbody > tr:nth-child(3) > th > a"))
			.filter(a => a.href.indexOf("/img_l/pdf") > -1);
		if (consolidatedPDF.length) {
			act.consolidatedPDF = consolidatedPDF[0].href;
			$(consolidatedPDF[0]).after(`<a id='btnSavePDF'><img src='${chrome.runtime.getURL("images/save.png")}'></a`);
		}
		// Preamble and Report to the King ?
		let preamble = Array.from(document.querySelectorAll("body > table > tbody > tr:nth-child(1) > th:nth-child(1)"))
			.filter(el => el.textContent.indexOf("Préambule") > -1);
		let report = Array.from(document.querySelectorAll("body > table > tbody > tr:nth-child(1) > th:nth-child(1)"))
			.filter(el => el.textContent.indexOf("Rapport au Roi") > -1);
		let heading = {}, article = {};
		heading.id = "visas";
		heading.type = "visas";
		heading.level = "level1";
		heading.text = "Visas";
		heading.content = "Visas";
		heading.children = [];
		if (preamble.length && (act.type != "loi")) {
			let preambleContent = "<br><div class='level2'>Préambule</div>"
				+ $(preamble[0]).parent().next().children().html();
			heading.children.push({id: "preamble_text", type: "article", level: "article", text: "Préambule", content: preambleContent});
		}
		if (report.length) {
			let reportContent = "<br><div class='level2'>Rapport au Roi</div>"
				+ $(report[0]).parent().next().children().html();
			heading.children.push({id: "report_text", type: "article", level: "article", text: "Rapport au Roi", content: reportContent});
		}
		if (heading.children.length) {
			headingsWhoseTypeNeedsToBeDefined.push(heading);
			act.content.push(heading);
		}
		// General information on the act
		act.info = document.querySelectorAll("body > table")[1].querySelector("tbody > tr:nth-child(3) > th").innerHTML;
		let additionalInfo = [];
		const INFO_URL_PARTS = ["arrexec", "arch_a", "wet", "reflex"];
		const anchors = Array.from(document.querySelectorAll("body > table")[0].querySelectorAll("a"));
		for (let u of INFO_URL_PARTS) {
			let a = anchors.filter(el => el.href.indexOf(u) > -1);
			if (a.length) {
				a[0].target = "_blank";
				if (u == "wet") {a[0].href += "&noJS=true";}
				additionalInfo.push(a[0].outerHTML);
			}
		}
		additionalInfo.push(`<a href='${act.eli}' target="_blank">ELI</a>`);
		additionalInfo.push(`<a id='clearDB' href='#'>Clear storage</a>`);
		additionalInfo.push(`<a href="${window.location.origin + window.location.pathname}`
							+`${window.location.search ? window.location.search + "&" : "?"}noJS=true" target="_blank">Disable extension</a></b>`);
		act.info += "<br><div id='addinfodiv'>" + additionalInfo.map(el => `<span style='font-weight: bold;'>${el}</span>`).join("") + "</div>";
	}

	async function displayContent(online) {
		async function loadHighlights() {
			// console.log("Start loading highlights", new Date());
			highlights = {
				quotes: await getStorage("highlights-" + act.eli) || {},
				selected: [],
				wrappers: {},
			};
			let changesMade = false;
			for (let key in highlights.quotes) {
				let article = $(`div#toc a:contains("${key}")`)?.[0]?.id;
				if (!key || !article) {
					console.info(`Loaded page does not contain anymore "${key}" article, deleting highlight from database`);
					delete highlights.quotes[key];
					changesMade = true;
				}
				else {
					for (let q of highlights.quotes[key]) {
						let range = anchoring.TextQuoteAnchor.toRange(document.querySelector(`div#content div#anchor_${article.slice(0,9)}`), q);
						if (!range) {
							console.info(`Quote ${JSON.stringify(q)} cannot be found anymore in article "${key}", deleting highlight from database`);
							let i = highlights.quotes[key].findIndex(el => el.id == q.id);
							highlights.quotes[key].splice(i, 1);
							if (!highlights.quotes[key].length) { delete highlights.quotes[key]; }
							changesMade = true;
						}
						else {
							let h = document.createElement("highlight");
							h.id = q.id;
							h.classList.add(q.color);
							if (q.annotation) { h.classList.add("annotated"); }
							let wrapper = anchoring.WrapRangeText(h, range);
							highlights.wrappers[h.id] = wrapper;
						}
					}
				}
			}
			if (changesMade) { await setStorage("highlights-" + act.eli, highlights.quotes); }
		}
		// Erase document and start afresh
		$("body").children().remove();
		$("body").append("<div id='main'><div id='info'></div><div id='hsplit'></div><div id ='maincontent'>"
						 + "<div id='toc'></div><div id='vsplit'></div><div id='content'></div></div><div id='status'></div></div>");
		// Set up resizable divs
		 $("div#info").resizable({
			 handleSelector: "div#hsplit",
			 resizeWidth: false
		 });
		 $("div#toc").resizable({
			 handleSelector: "div#vsplit",
			 resizeHeight: false
		 });
		// Build document info
		$("div#info").append(act.info);
		$("div#info").append("<br>");
		$("div#info a#btnSavePDF").on("click", function (event, date) {
			let a = document.createElement("a");
			a.style = "display: none";
			document.body.appendChild(a);
			a.href = act.consolidatedPDF;
			a.download = `${act.fullTitle}${act.date == act.lastUpdate ? "" : " (MAJ " + act.lastUpdate + ")"}.pdf`;
			a.click();
			a.remove();
		});
		// Add JSTree
		$("div#toc").append("<div id='btndiv'><button id='btnCollapse'>Collapse</button><button id='btnExpand'>Expand</button>"
							+ `<span class="${online}">${online ? "Act loaded from Justel" : "Act restored from database"}</span></div>`);
		$("button#btnCollapse").on("click", function (event, data) {
			$("div#jstree").jstree("close_all")
		});
		$("button#btnExpand").on("click", function (event, data) {
			$("div#jstree").jstree("open_all")
		});
		let el = document.createElement("div");
		el.id = "jstree";
		el.style.display = "none";
		$("div#toc").append(el);
		$("div#jstree").jstree({"core":
								{
									"data": act.content,
								},
								"plugins": [ "types" ],
								"types": {
									"article": {
										"icon": "jstree-file",
									},
								},
							   })
			.on("ready.jstree", async function (event, data) {
				$(this).jstree("open_all");
				await loadHighlights();
			})
			.on("select_node.jstree", function(event, data) {
				$("div#anchor_" + data.node.id)[0].scrollIntoView( true );
			});
		el.style.display = "";
		$("div#toc").append("<br><br>");
		// Populate content of the page
		let content = buildContent(act.content);
		$("div#content").append(content);
		$("div#content").append("<br><br>");
		// Button to clear DB
		$("a#clearDB").on("click", async function() {
			await setStorage(act.eli, {});
			updateInfo[act.eli].act = false;
			await setStorage("updateInfo", updateInfo);
			$("a#clearDB").parent().hide("slow");
		});
		// Change document title
		document.querySelector("head > title").text = act.fullTitle;
		// Set up highlighter
		$("div#content").on("mouseup", manageHighlights );
		$("div#content").append("<div id='toolbar' style='display: none;'><div class='circle yellow'></div><div class='circle green'></div><div class='circle blue'></div>"
								+"<div class='circle red'></div><div class='circle violet'></div><div class='circle'></div></div>");
		await runDropboxBackup();
	}

	async function manageHighlights(event) { // event = mouseUp event
		function getQuoteFromHighlight(h) {
			let currentArticle = $(h).parents(".article")[0].id;
			let articleText = $(`div#toc a#${currentArticle.slice(7)}_anchor`).text();
			let i = highlights.quotes[articleText].findIndex(el => el.id == h.id);
			return [currentArticle, articleText, i];
		}
		function linkifyUrls(text) {
			const urlRegex = /(?:(?:https?|ftp):\/\/|www\.)[^\s/$.?#].[^\s]*[^\s.,\])]/gi;
			return text.replace(urlRegex, url => `<a href="${url}">${url}</a>`);

		}
		let s = document.getSelection();
		let beginParentArticle = $(s.anchorNode).parents(".article");
		let endParentArticle = $(s.focusNode).parents(".article");
		// Only process selection if it exists and within the same article
		if (!s.isCollapsed && beginParentArticle.length && endParentArticle && beginParentArticle[0] == endParentArticle[0]) {
			// Show toolbar
			let relX = event.pageX + document.querySelector("div#content").scrollLeft - $(this).offset().left;
			let relY = event.pageY + document.querySelector("div#content").scrollTop - $(this).offset().top;
			$("div#toolbar").css({left: `${Math.min(relX - 5, $("div#content").width() - 200)}px`, top: `${relY + 10}px`}).show();
			currentRange = s.getRangeAt(0);
			currentArticle = beginParentArticle[0].id;
		}
		else {
			// Click without selection
			// Let's test whether user clicked on the circle of the toolbar
			if ( event.target.classList && Array.from(event.target.classList).includes("circle") ) {
				$("div#toolbar").hide();
				if (highlights.selected.length) {
					// A highlight is currently selected, change its color or remove highlight
					// highlights.selected.forEach( async function(h) {
					for (const h of highlights.selected) {
						let [currentArticle, articleText, i] = getQuoteFromHighlight(h);
						if (event.target.classList[1]) {
							// If a color has been selected, change color of selected highlights
							h.classList.remove(h.classList[0]);
							h.classList = event.target.classList[1] + " " + h.classList;
							highlights.quotes[articleText][i].color = event.target.classList[1];
							$(`annotation#${h.id}`).attr("class", event.target.classList[1]).hide();
							// Update localforage
							await setStorage("highlights-" + act.eli, highlights.quotes);
						}
						else {
							// Remove highlight
							highlights.wrappers[h.id].unwrap();
							highlights.wrappers[h.id] = null;
							highlights.quotes[articleText].splice(i, 1);
							if (!highlights.quotes[articleText].length) { delete highlights.quotes[articleText]; }
							// Remove annotation (if any)
							$(`annotation#${h.id}`).remove();
							// Save changes
							await setStorage("highlights-" + act.eli, highlights.quotes);
						}
					};
					highlights.selected.forEach( el => $(el).css({border: ""}) );
					highlights.selected = [];
				}
				else {
					// Do something if another color than white has been selected
					if (event.target.classList[1] != "white") {
						// Highlight it
						let quoteSelector = anchoring.TextQuoteAnchor.fromRange(document.querySelector("div#content"), currentRange);
						let h = document.createElement("highlight");
						h.classList.add(event.target.classList[1]);
						h.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
						let wrapper = anchoring.WrapRangeText(h, currentRange);
						// Save highlight
						let articleText = $(`div#toc a#${currentArticle.slice(7)}_anchor`).text();
						quoteSelector.color = event.target.classList[1];
						quoteSelector.id = h.id;
						highlights.quotes[articleText] = highlights.quotes[articleText] || [];
						highlights.quotes[articleText].push(quoteSelector);
						highlights.wrappers[h.id] = wrapper;
						// Save to localforage
						await setStorage("highlights-" + act.eli, highlights.quotes);
					}
				}
			}
			// Test if clicked on an existing highlight
			else if (event.target.nodeName == "HIGHLIGHT") {
				// Mark this highlight as selected
				$(event.target).css({border: "1px solid grey"});
				highlights.selected.push(event.target);
				// Show toolbar
				let relX = event.pageX + document.querySelector("div#content").scrollLeft - $(this).offset().left;
				let relY = event.pageY + document.querySelector("div#content").scrollTop - $(this).offset().top;
				$("div#toolbar").css({left: `${Math.min(relX - 5, $("div#content").width() - 200)}px`, top: `${relY + 10}px`}).show();
				// Show annotation
				if ( !$(`annotation#${event.target.id}`).length ) {
					// If annotation box does not exist for this highlight, create it
					let [currentArticle, articleText, i] = getQuoteFromHighlight(event.target);
					let annotationText = highlights.quotes[articleText][i]?.annotation || "";
					const urlRegex = /(?:(?:https?|ftp):\/\/|www\.)[^\s/$.?#].[^\s]*[^\s.,\])]/gi;
					annotationText = linkifyUrls(annotationText);
					$("div#content").append(`<annotation id="${event.target.id}" class="${event.target.classList[0]}" `
										   +`contenteditable="true">${annotationText}</annotation>`);
				}
				$(`annotation#${event.target.id}`).css({left: `${Math.min(relX - 5, $("div#content").width() - 200)}px`, top: `${relY - 130}px`}).show();
			}
			else if (event.target.nodeName == "A") {
				// Activate the link;
				window.open(event.target.href, '_blank');
			}
			else if (event.target.nodeName != "ANNOTATION") {
				// else erase highlight selection, hide annotation and toolbar
				currentRange = null;
				currentArticle = null;
				highlights.selected.forEach( async function(h) {
					// Hide border around selected highlight
					$(h).css({border: ""});
					// Hide annotation box
					$(`annotation#${h.id}`).hide();
					// Analyze and save content of annotation box
					let [currentArticle, articleText, i] = getQuoteFromHighlight(h);
					let previousAnnotation = highlights.quotes[articleText][i].annotation || "";
					let currentAnnotation = $(`annotation#${h.id}`).text() || "";
					if ( currentAnnotation != previousAnnotation ) {
						if (currentAnnotation) {
							let annotation = $(`annotation#${h.id}`).text()
							highlights.quotes[articleText][i].annotation = annotation;
							$(`annotation#${h.id}`).html(linkifyUrls(annotation));							
							h.classList.add("annotated");
						}
						else {
							h.classList.remove("annotated");
							delete highlights.quotes[articleText][i].annotation;
						}
						await setStorage("highlights-" + act.eli, highlights.quotes);
					}
				});
				highlights.selected = [];
				$("div#toolbar").hide();
			}
		}
	}

	// Hide table in order to accelerate dramatically loading of the DOM
	function processResultsPage() {
		if (document.querySelectorAll("frame")[1]?.contentDocument?.querySelector("frame")) {
			var forms = document.querySelectorAll("frame")[1].contentDocument.querySelector("frame").contentDocument.querySelectorAll("table form");
			for (var i = 0; i < forms.length; i++) {
				// En changeant la cible, on fait en sorte que chaque lien s'ouvre dans une nouvelle fenêtre
				// en changeant la méthode de post en get, on fait en sorte que les paramètres apparaissent dans l'adresse
				// enfin, en changeant l'action vers "loi_a1" au lieu de "loi_a", on fait en sorte que ça s'ouvre sans le footer de recherches
				forms[i].target = "_blank";
				forms[i].method = "get";
				forms[i].action = "/cgi_loi/loi_a1.pl";
			}
		}
	}

	async function analyseAct() {
		try {
			$("div#loading span#msg").text("Analysing content of the act");
			analyseFurtherInfo();
			analyseContent();
			$("div#loading span#msg").text("Storing the act in offline database");
			await setStorage(act.eli, act);
			updateInfo[act.eli] =
				{
				act: act.lastUpdate,
				date: act.date,
				fullTitle: act.fullTitle,
				script: chrome.runtime.getManifest().version,
			};
			await setStorage("updateInfo", updateInfo);
		}
		catch(e) {
			document.querySelector("div#loading").innerHTML = `Error while loading, click <a href=${window.location.origin + window.location.pathname}`
				+`${window.location.search ? window.location.search + "&" : "?"}noJS=true>here</a> to disable javascript`;
			console.error(e);
			return;
		}
		await displayContent(true);
	}

	async function runDropboxBackup() {
		if (!highlightsBackup.accessToken) {return;}
		let date = new Date().toJSON().slice(0,10);
		if (date != highlightsBackup.lastBackup) {
			let data = await getAllHighlights();
			let dbxAuth = new Dropbox.DropboxAuth({
				clientId: DROPBOX_CLIENT_ID,
			});
			dbxAuth.setAccessToken(highlightsBackup.accessToken);
			dbxAuth.setRefreshToken(highlightsBackup.refreshToken);
			let dbx = new Dropbox.Dropbox({
				auth: dbxAuth
			});
			let r = await dbx.filesUpload({
				path: '/' + highlightsBackup.filename /* + " " + date */ + ".json",
				contents: data,
				mode: {".tag": "overwrite"},
			});
			console.log("Backup to Dropbox done", r);
			const status = r.status == 200 ? "success" : "error " + r.status
			showStatusMessage(`Highlights have been backed up to Dropbox (${status})`);
			highlightsBackup.lastBackup = date;
			await setStorage("highlightsBackup", highlightsBackup);
		}
	}

	function addLoading(msg) {
		$("body").prepend(`<div id='loading'><div class="loadingio-spinner-spinner-is7uuvdj549"><div class="ldio-zrg2ss6p6ee">`
						 +`<div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>`
						 +`<div></div><div></div><div></div></div></div><span id='msg'>${msg}</span></div>`);
	}
	async function main() {
		// Identify act
		await analyseFirstInfo();
		// If URL is not ELI, redirect to ELI
		if ( ((window.location.origin + window.location.pathname) != act.eli)
			 && (act.eli.indexOf("cgi_loi") == -1) ) {
			window.location.href = act.eli;
			return;
		}
		// Now, check whether the latest version of the act is stored in the database
		updateInfo = await getStorage("updateInfo") || {};
		if ( (updateInfo[act.eli]?.script == chrome.runtime.getManifest().version)
			 && (updateInfo[act.eli]?.act == act.lastUpdate) ) {
			// Offline mode
			// Page can be restored since it did not change (nor the script)
			window.stop();
			addLoading("Restoring page from offline database");
			act = await getStorage(act.eli);
			displayContent(false);
		}
		else {
			// Online mode
			// Page must be loaded and analysed since it cannot be restored
			addLoading("Downloading page from eJustice server");
			if (document.readyState == "complete") {
				await analyseAct();
			}
			else {
				// console.log("Waiting for loading of the page");
				document.addEventListener("DOMContentLoaded", analyseAct);
			}
		}
	}
	
	// Start of the script
	highlightsBackup = await getStorage("highlightsBackup") || {};
	if ( window.location.href == "https://www.ejustice.just.fgov.be/loi/loi.htm" ) {
		// Main search page
		document.querySelectorAll("frame")[1].addEventListener("load", processResultsPage, false);
	}
	else if ( (window.location.origin + window.location.pathname) == "https://www.ejustice.just.fgov.be/eli/" ) {
		// ELI about page
		// Test if redirect from Dropbox
		if ( window.location.search.match(/code/) ) {
			let dbxAuth = new Dropbox.DropboxAuth({
				clientId: DROPBOX_CLIENT_ID,
			});
			dbxAuth.setCodeVerifier(highlightsBackup.codeVerifier);
			let u = new URLSearchParams(window.location.search);
			let response = await dbxAuth.getAccessTokenFromCode(DROPBOX_REDIRECT_URL, u.get("code"));
			highlightsBackup.accessToken = response.result.access_token;
			highlightsBackup.refreshToken = response.result.refresh_token;
			await setStorage("highlightsBackup", highlightsBackup);
			window.location.href = highlightsBackup.redirect;
		}
		else if ( window.location.search.match(/error/) ) {
			alert("User refused to grant access to Dropbox");
			if (highlightsBackup?.redirect) { window.location.href = highlightsBackup.redirect; }
		}
	}
	else if ( (window.location.protocol == "chrome-extension:") || (window.location.protocol == "moz-extension:") ) { 
		let u = new URLSearchParams(window.location.search);
		let eli = u.get("eli");
		if (!eli) {
			document.write("Error, you shouldn't access this page directly")
		}
		else {
			if (navigator.onLine) {
				// Let's redirect to online page since we are online
				window.location.href = eli;
				return;
			}
			// Offline mode
			addLoading("Restoring page from offline database");
			act = await getStorage(eli);
			if (act) {
				displayContent(false);
			}
			else {
				document.write(`Error, ${eli} has not been stored in the offline database`);
			}
		}
	}
	else {
		// Specific statute page
		let u = new URLSearchParams(window.location.search);
		if (!u.get("noJS")) {
			main();
		}
	}
})();
