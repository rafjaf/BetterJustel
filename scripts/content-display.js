window.BJ = window.BJ || {};
window.BJ.displayModule = function(ctx) {

	async function displayContent(online) {
		async function loadHighlights() {
			ctx.highlights = {
				quotes: await ctx.getStorage("highlights-" + ctx.act.eli) || {},
				selected: [],
				wrappers: {},
			};
			let changesMade = false;
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
						}
					}
				}
			}
			if (changesMade) { await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes); }
		}
		// Erase document and start afresh
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
		$("div#info").append("<br>");
		$("div#info a#btnSavePDF").on("click", function (event, date) {
			let a = document.createElement("a");
			a.style = "display: none";
			document.body.appendChild(a);
			a.href = ctx.act.consolidatedPDF;
			a.download = `${ctx.act.fullTitle}${ctx.act.date == ctx.act.lastUpdate ? "" : " (MAJ " + ctx.act.lastUpdate + ")"}.pdf`;
			a.click();
			a.remove();
		});
		// Add JSTree
		$("div#toc").append("<div id='btndiv'><button id='btnCollapse'>Collapse</button><button id='btnExpand'>Expand</button>"
							+ `<span class="${online}">${online ? "Act loaded from Justel" : "Act restored"}</span></div>`);
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
									"data": ctx.act.content,
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
				$("div#anchor_" + data.node.id)[0].scrollIntoView( true );
			});
		el.style.display = "";
		$("div#toc").append("<br><br>");
		// Populate content of the page
		let content = ctx.buildContent(ctx.act.content);
		$("div#content").append(content);
		$("div#content").append("<br><br>");
		// Button to clear DB
		$("a#clearDB").on("click", async function() {
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
