window.BJ = window.BJ || {};
window.BJ.displayModule = function(ctx) {
	function literaryApostrophes(text) {
		return text.replace(/(\p{L})'/gu, "$1’");
	}

	function handleCopy(event) {
		const selection = document.getSelection();
		if (!event.clipboardData || !selection?.toString()) { return; }
		const text = selection.toString();
		const corrected = literaryApostrophes(text);
		if (corrected === text) { return; }
		const container = document.createElement("div");
		for (let i = 0; i < selection.rangeCount; i++) {
			container.appendChild(selection.getRangeAt(i).cloneContents());
		}
		let previousCharacter = "";
		function correctFragment(node) {
			if (node.nodeType === Node.TEXT_NODE) {
				node.textContent = literaryApostrophes(previousCharacter + node.textContent).slice(previousCharacter.length);
				previousCharacter = node.textContent.slice(-1) || previousCharacter;
				return;
			}
			const separatesParagraphs = /^(BR|DIV|P|LI|BLOCKQUOTE|H[1-6]|TR)$/.test(node.nodeName);
			if (separatesParagraphs) { previousCharacter = ""; }
			for (const child of node.childNodes) { correctFragment(child); }
			if (separatesParagraphs) { previousCharacter = ""; }
		}
		correctFragment(container);
		event.clipboardData.setData("text/plain", corrected);
		event.clipboardData.setData("text/html", container.innerHTML);
		event.preventDefault();
	}

	async function copyText(text) {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const input = document.createElement("textarea");
		input.value = text;
		input.style.position = "fixed";
		input.style.left = "-9999px";
		document.body.appendChild(input);
		input.select();
		const copied = document.execCommand("copy");
		input.remove();
		if (!copied) { throw new Error("Clipboard access was refused"); }
	}

	function normalizeJustelLinks(container) {
		if (!container) { return; }

		let justelBase;
		try {
			justelBase = new URL("/cgi_loi/", ctx.act.eli);
		}
		catch (e) {
			justelBase = new URL("https://www.ejustice.just.fgov.be/cgi_loi/");
		}

		for (const link of container.querySelectorAll("a[href]")) {
			const href = link.getAttribute("href")?.trim();
			if (!href || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) {
				continue;
			}
			try {
				// Justel's stored markup contains both root-relative (/cgi_loi/...)
				// and directory-relative (article.pl?...) links. Resolve both against
				// Justel instead of the chrome-extension:// offline page.
				link.href = href.startsWith("/")
					? new URL(href, justelBase.origin).href
					: new URL(href, justelBase).href;
			}
			catch (e) {
				console.warn("[Better Justel] Could not resolve stored link:", href);
			}
		}
	}

	function setupCopyEli() {
		let link = document.querySelector("div#info a#copyELI");
		if (!link) {
			// Upgrade the ELI link embedded in acts cached by an older extension version.
			link = Array.from(document.querySelectorAll("div#info a"))
				.find(a => a.textContent.trim() === "ELI" && a.href === ctx.act.eli);
		}
		if (!link) { return; }
		link.id = "copyELI";
		link.href = "#";
		link.removeAttribute("target");
		link.textContent = "Copy ELI";
		link.title = ctx.act.eli;
		link.addEventListener("click", async function(event) {
			event.preventDefault();
			try {
				await copyText(ctx.act.eli);
				ctx.showStatusMessage("ELI copied to clipboard");
			}
			catch (e) {
				console.error("[Better Justel] Could not copy ELI:", e.message);
				ctx.showStatusMessage("Could not copy the ELI to the clipboard");
			}
		});
	}

	function enhanceInfoPanel(online) {
		const info = document.querySelector("div#info");
		if (!info) { return; }
		info.classList.add("act-header");
		info.setAttribute("aria-label", "Act information and actions");

		const brand = document.createElement("a");
		brand.className = "act-header__brand";
		brand.href = "https://github.com/rafjaf/BetterJustel";
		brand.target = "_blank";
		brand.rel = "noopener noreferrer";
		brand.textContent = "Better Justel";
		brand.title = "Enhanced by Better Justel";
		const captions = document.createElement("div");
		captions.className = "act-header__captions";
		const status = document.createElement("span");
		status.id = "act-load-status";
		status.className = `act-header__caption ${Boolean(online)}`;
		status.textContent = online ? "Act loaded from Justel" : "Act restored";
		captions.append(status, brand);
		info.prepend(captions);

		const heading = info.querySelector("p.list-item--title");
		const title = heading?.querySelector(":scope > span.title");
		if (heading) {
			heading.classList.add("act-header__heading");
		}
		if (heading && title) {
			title.classList.add("act-header__title");
			const notes = document.createElement("span");
			notes.className = "act-header__notes";
			while (title.nextSibling) {
				notes.appendChild(title.nextSibling);
			}
			if (notes.textContent.trim() || notes.children.length) {
				heading.appendChild(notes);
			}
		}

		const metadata = info.querySelector("div.plain-text");
		let actions = info.querySelector("div#addinfodiv");
		if (!actions) {
			actions = document.createElement("div");
			actions.id = "addinfodiv";
			info.appendChild(actions);
		}
		actions.classList.add("act-header__actions");
		actions.setAttribute("role", "group");
		actions.setAttribute("aria-label", "Document actions and related resources");

		if (metadata) {
			metadata.classList.add("act-header__metadata");
			metadata.setAttribute("aria-label", "Document metadata");
			let lastMetadataItem = null;
			const relatedActions = [];

			for (const item of Array.from(metadata.children)) {
				const text = item.textContent.trim();
				if (item.classList.contains("tag-small")) {
					const value = lastMetadataItem?.querySelector(".act-header__meta-value");
					if (value) {
						value.appendChild(item);
					}
					continue;
				}

				if (/(versions? archiv|arr.t.s? d['’]ex.cution)/i.test(text) && item.querySelector("a")) {
					relatedActions.push(item);
					continue;
				}

				item.classList.add("act-header__meta-item");
				const label = item.querySelector(":scope > strong");
				if (label) {
					const labelText = label.textContent.trim().replace(/\s*:\s*$/, "");
					const value = document.createElement("span");
					value.className = "act-header__meta-value";
					while (label.nextSibling) {
						value.appendChild(label.nextSibling);
					}
					label.className = "act-header__meta-label";
					label.textContent = labelText;
					item.appendChild(value);

					if (/^(source|entr.e en vigueur|ce texte modifie)/i.test(labelText)) {
						item.classList.add("act-header__meta-item--wide");
					}
				}
				lastMetadataItem = item;
			}

			for (const node of Array.from(metadata.childNodes)) {
				if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
					node.remove();
				}
			}

			const clearAction = actions.querySelector("a#clearDB")?.parentElement;
			for (const relatedAction of relatedActions) {
				actions.insertBefore(relatedAction, clearAction || null);
			}
		}

		for (const action of Array.from(actions.children)) {
			action.classList.add("act-header__action");
			const link = action.querySelector("a");
			if (!link) { continue; }
			link.classList.add("act-header__button");
			if (link.id === "copyELI") {
				link.classList.add("act-header__button--primary");
			}
			if (link.id === "clearDB") {
				link.classList.add("act-header__button--danger");
			}
			if (link.id === "btnSavePDF") {
				link.classList.add("act-header__button--icon");
				link.title = "Download consolidated PDF";
				link.setAttribute("aria-label", "Download consolidated PDF");
			}
		}
	}

	async function displayContent(online) {
		async function loadHighlights() {
			ctx.highlights = {
				quotes: await ctx.getStorage("highlights-" + ctx.act.eli) || {},
				selected: [],
				wrappers: {},
			};
			let changesMade = false;
			// Keep highlights and bookmarks attached when repairing a cached title.
			for (const [oldTitle, title] of Object.entries(ctx.articleTitleAliases || {})) {
				if (ctx.highlights.quotes[oldTitle]) {
					const quotes = ctx.highlights.quotes[title] || [];
					for (const quote of ctx.highlights.quotes[oldTitle]) {
						if (!quotes.some(existing => existing.id === quote.id)) { quotes.push(quote); }
					}
					ctx.highlights.quotes[title] = quotes;
					delete ctx.highlights.quotes[oldTitle];
					changesMade = true;
				}
				if (ctx.highlights.quotes.bookmarks?.[oldTitle]) {
					ctx.highlights.quotes.bookmarks[title] = ctx.highlights.quotes.bookmarks[oldTitle];
					delete ctx.highlights.quotes.bookmarks[oldTitle];
					changesMade = true;
				}
			}
			for (let key in ctx.highlights.quotes) {
				if (key == "bookmarks") {
					for (let bookmark in ctx.highlights.quotes.bookmarks) {
						let article = $(`div#toc a:contains("${bookmark}")`)?.[0]?.id;
						document.querySelector(`div#content div#anchor_${article?.slice(0,9)}`)?.classList?.add("bookmark");
					}
				}
				else {
					let article = $(`div#toc a:contains("${key}")`)?.[0]?.id;
					if (!key || !article) {
						ctx.showStatusMessage(`Loaded page does not contain anymore "${key}" article, deleting highlight from database`);
						console.info(`Loaded page does not contain anymore "${key}" article, deleting highlight from database`);
						delete ctx.highlights.quotes[key];
						changesMade = true;
					}
					else {
						for (let q of ctx.highlights.quotes[key]) {
							try {
								let range = anchoring.TextQuoteAnchor.toRange(document.querySelector(`div#content div#anchor_${article.slice(0,9)}`), q);
								if (!range) {
									ctx.showStatusMessage(`Quote ${JSON.stringify(q)} cannot be found anymore in article "${key}", deleting highlight from database`);
									console.info(`Quote ${JSON.stringify(q)} cannot be found anymore in article "${key}", deleting highlight from database`);
									let i = ctx.highlights.quotes[key].findIndex(el => el.id == q.id);
									ctx.highlights.quotes[key].splice(i, 1);
									if (!ctx.highlights.quotes[key].length) { delete ctx.highlights.quotes[key]; }
									changesMade = true;
								}
								else {
									let h = document.createElement("highlight");
									h.id = q.id;
									h.classList.add(q.color);
									if (q.annotation) { h.classList.add("annotated"); }
									let wrapper = anchoring.WrapRangeText(h, range);
									ctx.highlights.wrappers[h.id] = wrapper;
								}
							} catch (e) {
								console.warn(`[Better Justel] Error anchoring highlight in article "${key}":`, e.message);
								let i = ctx.highlights.quotes[key].findIndex(el => el.id == q.id);
								if (i !== -1) {
									ctx.highlights.quotes[key].splice(i, 1);
									if (!ctx.highlights.quotes[key].length) { delete ctx.highlights.quotes[key]; }
									changesMade = true;
								}
							}
						}
					}
				}
			}
			if (changesMade) { await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes); }
		}
		// Erase document and start afresh
		// The online document's styles otherwise keep affecting the rebuilt DOM,
		// while the standalone offline document has only Better Justel's styles.
		// Parsing is complete at this point, so the original Justel CSS is no
		// longer needed and can safely be detached.
		document.querySelectorAll('link[rel~="stylesheet"]').forEach(function(link) {
			try {
				if (new URL(link.href).hostname === "www.ejustice.just.fgov.be") {
					link.remove();
				}
			}
			catch (_) {}
		});
		document.body.removeAttribute("style");
		document.body.className = "better-justel";
		$("body").children().remove();
		$("body").append(`<div id='main'>
								<div id='info'></div>
								<div id='hsplit'></div>
								<div id ='maincontent'>
									<div id='toc'></div>
									<div id='vsplit'></div>
									<div id='content'></div>
								</div>
								<div id='bookmark-bar'><div id='minmax'>▼</div><div id='title'>Bookmarks</div><div id='items'></div></div>
								<div id='status'></div>
							</div>`);
		// Set up resizable divs
		 $("div#info").resizableSafe({
			 handleSelector: "div#hsplit",
			 resizeWidth: false
		 });
		 $("div#toc").resizableSafe({
			 handleSelector: "div#vsplit",
			 resizeHeight: false
		 });
		// Build document info
		$("div#info").append(ctx.act.info);
		normalizeJustelLinks(document.querySelector("div#info"));
		setupCopyEli();
		enhanceInfoPanel(online);
		$("div#info a#btnSavePDF").on("click", function (event, date) {
			let a = document.createElement("a");
			a.style = "display: none";
			document.body.appendChild(a);
			a.href = ctx.act.consolidatedPDF;
			a.download = `${ctx.act.fullTitle}${ctx.act.date == ctx.act.lastUpdate ? "" : " (MAJ " + ctx.act.lastUpdate + ")"}.pdf`;
			a.click();
			a.remove();
		});
		// Build before the TOC so repaired cached article titles also appear there.
		let content = ctx.buildContent(ctx.act.content);
		// Add JSTree
		const icon = paths => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
		$("div#toc").append(`<div id="btndiv" role="group" aria-label="Table of contents controls">
			<button id="btnCollapse" type="button" aria-label="Collapse all" title="Collapse all">${icon('<path d="m7 4 5 5 5-5M7 20l5-5 5 5M4 12h16"/>')}</button>
			<button id="btnExpand" type="button" aria-label="Expand all" title="Expand all">${icon('<path d="m7 8 5-5 5 5M7 16l5 5 5-5M4 12h16"/>')}</button>
			<button id="btnAutoscroll" type="button" aria-label="Autoscroll" aria-pressed="false" title="Enable autoscroll: follow the text in the table of contents">${icon('<path d="M4 4h7M4 8h7M4 12h7M4 16h7M4 20h7M18 3v18m-3-3 3 3 3-3m-6-12 3-3 3 3"/>')}</button>
			<button id="btnJump" type="button" aria-label="Jump to article" title="Jump to article">${icon('<path d="M4 5h6M4 9h6M4 13h6M4 17h6M14 5h6v14m-4-4 4 4 4-4"/>')}</button>
		</div>`);
		$("body").append(`<dialog id="article-jump-dialog" aria-labelledby="article-jump-title" aria-describedby="article-jump-help">
			<form id="article-jump" novalidate>
				<h2 id="article-jump-title">Jump to article</h2>
				<p id="article-jump-help">Enter an article number, such as 23, 6ter or XV.125/5.</p>
				<label for="article-number">Article number</label>
				<input id="article-number" name="article" autocomplete="off" aria-describedby="article-jump-error" autofocus>
				<p id="article-jump-error" aria-live="polite"></p>
				<div class="article-jump-actions"><button id="article-jump-cancel" type="button">Cancel</button><button type="submit">Jump</button></div>
			</form>
		</dialog>`);
		const articles = new Map();
		function articleNumber(text) {
			return text.trim().replace(/^Art(?:\.|icle)?\s*/i, "").replace(/\.+$/, "").toLowerCase();
		}
		function indexArticles(nodes) {
			for (const node of nodes) {
				if (node.type === "article") {
					const number = node.text.match(/^Art(?:\.|icle)\s*([\w./:-]+)/i)?.[1]?.replace(/\.+$/, "");
					if (number && !articles.has(articleNumber(number))) {
						articles.set(articleNumber(number), node.id);
					}
				}
				if (node.children) { indexArticles(node.children); }
			}
		}
		indexArticles(ctx.act.content);
		const jumpDialog = document.getElementById("article-jump-dialog");
		const articleInput = document.getElementById("article-number");
		const jumpError = document.getElementById("article-jump-error");
		articleInput.addEventListener("input", function() {
			jumpError.textContent = "";
			articleInput.removeAttribute("aria-invalid");
		});
		document.getElementById("btnJump").addEventListener("click", function() {
			articleInput.dispatchEvent(new Event("input"));
			jumpDialog.showModal();
			articleInput.focus();
			articleInput.select();
		});
		document.getElementById("article-jump-cancel").addEventListener("click", () => jumpDialog.close());
		jumpDialog.addEventListener("close", () => document.getElementById("btnJump").focus({preventScroll: true}));
		function revealTocNode(id, center = false) {
			const tree = $("div#jstree").jstree(true);
			const node = tree.get_node(id);
			tree.open_node(node.parents.filter(parent => parent !== "#"), false, 0);
			const toc = document.getElementById("toc");
			const anchor = document.getElementById(id + "_anchor");
			const bounds = toc.getBoundingClientRect();
			const row = anchor.getBoundingClientRect();
			const toolbarHeight = document.getElementById("btndiv").offsetHeight;
			if (center || row.top < bounds.top + toolbarHeight || row.bottom > bounds.top + toc.clientHeight) {
				toc.scrollTop += row.top - bounds.top - toolbarHeight
					- (toc.clientHeight - toolbarHeight - row.height) / 2;
			}
		}
		document.getElementById("article-jump").addEventListener("submit", function(event) {
			event.preventDefault();
			const id = articles.get(articleNumber(articleInput.value));
			if (!id) {
				jumpError.textContent = articleInput.value.trim() ? "This article was not found in this act." : "Enter an article number.";
				articleInput.setAttribute("aria-invalid", "true");
				articleInput.focus();
				return;
			}
			jumpDialog.close();
			const tree = $("div#jstree").jstree(true);
			const node = tree.get_node(id);
			tree.open_node(node.parents.filter(parent => parent !== "#"), false, 0);
			tree.deselect_all(true);
			tree.select_node(id);
			requestAnimationFrame(() => revealTocNode(id, true));
		});
		$("button#btnCollapse").on("click", function (event, data) {
			$("div#jstree").jstree("close_all")
		});
		$("button#btnExpand").on("click", function (event, data) {
			$("div#jstree").jstree("open_all")
		});
		let followingText = false;
		let el = document.createElement("div");
		el.id = "jstree";
		el.style.display = "none";
		$("div#toc").append(el);
		$("div#jstree").jstree({"core":
								{
									"data": ctx.act.content,
									"worker": false,
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
				ctx.updateBookmarkBar();
				// Load and display case law after content and highlights are ready
				await ctx.loadAndDisplayCaseLaw();
			})
			.on("select_node.jstree", function(event, data) {
				if (followingText) { return; }
				$("div#anchor_" + data.node.id)[0].scrollIntoView( true );
			});
		el.style.display = "";
		$("div#toc").append("<br><br>");
		// Populate content of the page
		$("div#content").append(content);
		// Resolve modifying-law links in cached article HTML as well as header links.
		normalizeJustelLinks(document.querySelector("div#content"));
		$("div#content").append("<br><br>");
		const textPane = document.getElementById("content");
		const textAnchors = Array.from(textPane.querySelectorAll('div[id^="anchor_"]'));
		const autoscrollButton = document.getElementById("btnAutoscroll");
		let autoscroll = (await ctx.getStorage("tocAutoscroll")) === true;
		let scrollFrame = null;
		function updateAutoscrollButton() {
			autoscrollButton.setAttribute("aria-pressed", String(autoscroll));
			autoscrollButton.title = `${autoscroll ? "Disable" : "Enable"} autoscroll: follow the text in the table of contents`;
		}
		updateAutoscrollButton();
		function followText() {
			scrollFrame = null;
			if (!autoscroll || !textAnchors.length) { return; }
			const top = textPane.getBoundingClientRect().top + 1;
			// Anchors occur in document order; binary search also handles long acts
			// without measuring every article on each scroll frame.
			let low = 0, high = textAnchors.length;
			while (low < high) {
				const mid = Math.floor((low + high) / 2);
				if (textAnchors[mid].getBoundingClientRect().top <= top) { low = mid + 1; }
				else { high = mid; }
			}
			const id = textAnchors[Math.max(0, low - 1)].id.slice(7);
			const tree = $("div#jstree").jstree(true);
			if (!tree?.get_node(id)) { return; }
			// jsTree's suppress_event argument only suppresses "changed", not
			// "select_node". Guard our navigation handler while following text.
			followingText = true;
			try {
				revealTocNode(id);
				if (!tree.is_selected(id)) {
					tree.deselect_all(true);
					tree.select_node(id, true);
				}
			}
			finally { followingText = false; }
		}
		textPane.addEventListener("scroll", function() {
			if (autoscroll && scrollFrame === null) { scrollFrame = requestAnimationFrame(followText); }
		}, {passive: true});
		autoscrollButton.addEventListener("click", function() {
			autoscroll = !autoscroll;
			updateAutoscrollButton();
			ctx.setStorage("tocAutoscroll", autoscroll);
			if (autoscroll) { followText(); }
		});
		ctx.setupArticleHistory?.();
		// Button to clear DB
		$("a#clearDB").on("click", async function() {
			await ctx.clearArticleHistory?.();
			await ctx.setStorage(ctx.act.eli, {});
			ctx.updateInfo[ctx.act.eli].act = false;
			await ctx.setStorage("updateInfo", ctx.updateInfo);
			ctx.numac2eli[ctx.act.numac] = "";
			await ctx.setStorage("numac2eli", ctx.numac2eli);
			// Clear case-law fetch flag to allow re-check
			await ctx.clearCaselawFetchFlag();
			$("a#clearDB").parent().hide("slow");
		});
		// Change document title
		document.querySelector("head > title").text = ctx.act.fullTitle;
		// Set up bookmark bar
		try { $("div#bookmark-bar").draggable(); } catch(e) { console.warn("draggable not available:", e.message); }
		$("div#bookmark-bar div#items div").on('mousedown', function(e) {
			e.stopPropagation(); // Prevents the mousedown event from reaching the parent
		});
		$("div#bookmark-bar div#items").click(async function(e){
			switch(e.target.className) {
				case "bookmark":
					// Remove bookmark from this article
					let currentArticleElem = document.querySelector("div#" + e.target.nextElementSibling.getAttribute("target"));
					let currentArticle = currentArticleElem.id;
					// let articleText = $(`div#toc a#${currentArticle.slice(7)}_anchor`).text();
					let articleText = ctx.findObjectById(ctx.act, currentArticle.slice(7)).text;
					currentArticleElem.classList.remove("bookmark");
					delete ctx.highlights.quotes.bookmarks[articleText];
					await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
					ctx.updateBookmarkBar();
					break;
				case "item":
					$("div#" + e.target.getAttribute("target"))[0].scrollIntoView(true);
					// Also expand and scroll to the relevant article in the TOC
					let nodeId = e.target.getAttribute("target").replace("anchor_", "");
					let jstreeInst = $("div#jstree").jstree(true);
					if (jstreeInst) {
						jstreeInst.deselect_all(true);
						jstreeInst.open_node(jstreeInst.get_parent(nodeId));
						jstreeInst.select_node(nodeId, true);
						let tocNode = document.getElementById(nodeId + "_anchor") || document.getElementById(nodeId);
						if (tocNode) { tocNode.scrollIntoView({block: "center"}); }
					}
					break;
			}
		})
		$("div#bookmark-bar div#minmax").click(function() {
			const div = document.querySelector("div#bookmark-bar div#items");
			if (div.style.display == "none") {
				div.style.display = "block";
			}
			else {
				div.style.display = "none";
			}
		});
		// Hide margin annotations (Al., bookmarks) while text is selected
		document.removeEventListener("copy", handleCopy);
		document.addEventListener("copy", handleCopy);
		document.addEventListener("selectionchange", function() {
			const sel = window.getSelection();
			if (sel && sel.toString().length > 0) {
				document.body.classList.add("has-selection");
			} else {
				document.body.classList.remove("has-selection");
			}
		});
		// Set up highlighter
		$("div#content").on("mouseup", ctx.manageHighlights );
		$("div#content").append("<div id='toolbar' style='display: none;'><div class='circle yellow'></div><div class='circle green'></div><div class='circle blue'></div>"
								+"<div class='circle red'></div><div class='circle violet'></div><div class='circle'></div></div>");
		await ctx.runDropboxBackup();
		// Display status message if extension was updated
		const lastVersion = await ctx.getStorage("extensionVersion");
		const currentVersion = chrome.runtime.getManifest().version;
		if (lastVersion != currentVersion) {
			ctx.showStatusMessage(`Better Justel has been updated to version ${currentVersion}. Click <a href="https://github.com/rafjaf/BetterJustel#release-history" target="_blank">here</a> for more info`);
			await ctx.setStorage("extensionVersion", currentVersion);
		}
	}

	return { displayContent };
};
