window.BJ = window.BJ || {};
window.BJ.highlightsModule = function(ctx) {

	async function manageHighlights(event) { // event = mouseUp event
		function getQuoteFromHighlight(h) {
			// Check if this highlight is inside a case-law block
			if (ctx.isInCaselawBlock(h)) {
				return [null, null, -1, true]; // isCaselaw = true
			}
			let currentArticle = $(h).parents(".article")[0].id;
			// let articleText = $(`div#toc a#${currentArticle.slice(7)}_anchor`).text();
			let articleText = ctx.findObjectById(ctx.act, currentArticle.slice(7)).text;
			let i = ctx.highlights.quotes[articleText].findIndex(el => el.id == h.id);
			return [currentArticle, articleText, i, false];
		}
		function buildLinkedTextFragment(text) {
			const urlRegex = /(?:(?:https?|ftp):\/\/[^\s<>"']+|file:\/\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
			const plainText = String(text || "");
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			plainText.replace(urlRegex, function(url, offset) {
				const trimmedUrl = url.replace(/[.,\])]+$/g, "");
				const trailingText = url.slice(trimmedUrl.length);
				fragment.appendChild(document.createTextNode(plainText.slice(lastIndex, offset)));
				const href = /^www\./i.test(trimmedUrl) ? `http://${trimmedUrl}` : trimmedUrl;
				const link = document.createElement("a");
				link.href = href;
				link.textContent = trimmedUrl;
				fragment.appendChild(link);
				fragment.appendChild(document.createTextNode(trailingText));
				lastIndex = offset + url.length;
				return url;
			});
			fragment.appendChild(document.createTextNode(plainText.slice(lastIndex)));
			return fragment;
		}
		function openLink(url) {
			if (/^file:\/\//i.test(url)) {
				chrome.runtime.sendMessage({ action: "openUrl", url });
				return;
			}
			window.open(url, "_blank");
		}
		function handleAnnotationClick(event) {
			const link = event.target.closest("a");
			if (!link) { return; }

			event.preventDefault();
			event.stopPropagation();
			openLink(link.href);
		}
		function getAnnotationResizeDirection(event) {
			const annotation = event.currentTarget;
			const resizeZone = 7;
			const rect = annotation.getBoundingClientRect();
			const onNorth = event.clientY - rect.top <= resizeZone;
			const onEast = rect.right - event.clientX <= resizeZone;
			const onSouth = rect.bottom - event.clientY <= resizeZone;
			const onWest = event.clientX - rect.left <= resizeZone;

			return `${onNorth ? "n" : ""}${onSouth ? "s" : ""}${onEast ? "e" : ""}${onWest ? "w" : ""}`;
		}
		function getAnnotationResizeCursor(direction) {
			if (direction == "ne" || direction == "sw") { return "nesw-resize"; }
			if (direction == "nw" || direction == "se") { return "nwse-resize"; }
			if (direction == "n" || direction == "s") { return "ns-resize"; }
			if (direction == "e" || direction == "w") { return "ew-resize"; }
			return "";
		}
		function addAnnotationResize(annotation) {
			if (annotation.dataset.resizeReady) { return; }
			annotation.dataset.resizeReady = "true";
			annotation.addEventListener("click", handleAnnotationClick);
			annotation.addEventListener("pointermove", setAnnotationResizeCursor);
			annotation.addEventListener("pointerleave", clearAnnotationResizeCursor);
			annotation.addEventListener("pointerdown", startAnnotationResize);
		}
		function setAnnotationResizeCursor(event) {
			const direction = getAnnotationResizeDirection(event);
			event.currentTarget.style.cursor = getAnnotationResizeCursor(direction);
		}
		function clearAnnotationResizeCursor(event) {
			if (!event.currentTarget.classList.contains("resizing")) {
				event.currentTarget.style.cursor = "";
			}
		}
		function startAnnotationResize(event) {
			const direction = getAnnotationResizeDirection(event);
			if (!direction) { return; }

			event.preventDefault();
			event.stopPropagation();

			const annotation = event.currentTarget;
			const minWidth = parseFloat(getComputedStyle(annotation).minWidth) || 120;
			const minHeight = parseFloat(getComputedStyle(annotation).minHeight) || 60;
			const startX = event.clientX;
			const startY = event.clientY;
			const startWidth = annotation.offsetWidth;
			const startHeight = annotation.offsetHeight;
			const startLeft = parseFloat(annotation.style.left) || annotation.offsetLeft;
			const startTop = parseFloat(annotation.style.top) || annotation.offsetTop;

			annotation.setPointerCapture(event.pointerId);
			annotation.classList.add("resizing");
			annotation.style.cursor = getAnnotationResizeCursor(direction);

			function resize(moveEvent) {
				const dx = moveEvent.clientX - startX;
				const dy = moveEvent.clientY - startY;
				let width = startWidth;
				let height = startHeight;
				let left = startLeft;
				let top = startTop;

				if (direction.includes("e")) {
					width = Math.max(minWidth, startWidth + dx);
				}
				if (direction.includes("s")) {
					height = Math.max(minHeight, startHeight + dy);
				}
				if (direction.includes("w")) {
					width = Math.max(minWidth, startWidth - dx);
					left = startLeft + startWidth - width;
				}
				if (direction.includes("n")) {
					height = Math.max(minHeight, startHeight - dy);
					top = startTop + startHeight - height;
				}

				annotation.style.width = `${width}px`;
				annotation.style.height = `${height}px`;
				annotation.style.left = `${left}px`;
				annotation.style.top = `${top}px`;
			}
			function stopResize(upEvent) {
				upEvent.preventDefault();
				upEvent.stopPropagation();
				annotation.classList.remove("resizing");
				annotation.style.cursor = "";
				annotation.releasePointerCapture(event.pointerId);
				annotation.removeEventListener("pointermove", resize);
				annotation.removeEventListener("pointerup", stopResize);
				annotation.removeEventListener("pointercancel", stopResize);
			}

			annotation.addEventListener("pointermove", resize);
			annotation.addEventListener("pointerup", stopResize);
			annotation.addEventListener("pointercancel", stopResize);
		}
		function renderAnnotation(annotation, text) {
			annotation.replaceChildren(buildLinkedTextFragment(text));
			addAnnotationResize(annotation);
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
			ctx.currentRange = s.getRangeAt(0);
			ctx.currentArticle = beginParentArticle[0].id;
		}
		else {
			// Click without selection
			// Let's test whether user clicked on the circle of the toolbar
			if ( event.target.classList && Array.from(event.target.classList).includes("circle") ) {
				$("div#toolbar").hide();
				if (ctx.highlights.selected.length) {
					// A highlight is currently selected, change its color or remove highlight
					// highlights.selected.forEach( async function(h) {
					for (const h of ctx.highlights.selected) {
						let [currentArticle, articleText, i, isCaselaw] = getQuoteFromHighlight(h);
						if (event.target.classList[1]) {
							// If a color has been selected, change color of selected highlights
							h.classList.remove(h.classList[0]);
							h.classList = event.target.classList[1] + " " + h.classList;
							if (isCaselaw) {
								await ctx.updateCaselawHighlight(h, { color: event.target.classList[1] });
							} else {
								ctx.highlights.quotes[articleText][i].color = event.target.classList[1];
								await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
							}
							$(`annotation#${h.id}`).attr("class", event.target.classList[1]).hide();
						}
						else {
							// Remove highlight
							ctx.highlights.wrappers[h.id].unwrap();
							ctx.highlights.wrappers[h.id] = null;
							if (isCaselaw) {
								await ctx.removeCaselawHighlight(h);
							} else {
								ctx.highlights.quotes[articleText].splice(i, 1);
								if (!ctx.highlights.quotes[articleText].length) { delete ctx.highlights.quotes[articleText]; }
								await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
							}
							// Remove annotation (if any)
							$(`annotation#${h.id}`).remove();
						}
					};
					ctx.highlights.selected.forEach( el => $(el).css({border: ""}) );
					ctx.highlights.selected = [];
				}
				else {
					// Do something if another color than white has been selected
					if (event.target.classList[1] != "white") {
					  try {
						// Check if we are in a case-law block
						let inCaselaw = ctx.isInCaselawBlock(ctx.currentRange.startContainer);
						// Highlight it
						let startEl = ctx.currentRange.startContainer.nodeType === Node.TEXT_NODE
							? ctx.currentRange.startContainer.parentElement
							: ctx.currentRange.startContainer;
						let anchorRoot = inCaselaw
							? $(startEl).closest(".caselaw-content")[0]
							: document.querySelector("div#content");
						let quoteSelector = anchoring.TextQuoteAnchor.fromRange(anchorRoot, ctx.currentRange);
						let h = document.createElement("highlight");
						h.classList.add(event.target.classList[1]);
						h.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
						let wrapper = anchoring.WrapRangeText(h, ctx.currentRange);
						ctx.highlights.wrappers[h.id] = wrapper;
						quoteSelector.color = event.target.classList[1];
						quoteSelector.id = h.id;
						if (inCaselaw) {
							// Save to case-law highlights
							let articleDiv = $(startEl).closest(".article")[0];
							let articleId = articleDiv ? articleDiv.id.replace("anchor_", "") : "";
							await ctx.saveCaselawHighlight(articleId, quoteSelector);
						} else {
							// Save highlight to regular storage
							let articleText = ctx.findObjectById(ctx.act, ctx.currentArticle.slice(7)).text;
							quoteSelector.color = event.target.classList[1];
							quoteSelector.id = h.id;
							ctx.highlights.quotes[articleText] = ctx.highlights.quotes[articleText] || [];
							ctx.highlights.quotes[articleText].push(quoteSelector);
							await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
						}
					  } catch (e) {
						console.warn("[Better Justel] Error creating highlight (anchoring failed):", e.message);
					  }
					}
				}
			}
			// Test if clicked on an existing highlight
			else if (event.target.nodeName == "HIGHLIGHT") {
				// Mark this highlight as selected
				$(event.target).css({border: "1px solid grey"});
				ctx.highlights.selected.push(event.target);
				// Show toolbar
				let relX = event.pageX + document.querySelector("div#content").scrollLeft - $(this).offset().left;
				let relY = event.pageY + document.querySelector("div#content").scrollTop - $(this).offset().top;
				$("div#toolbar").css({left: `${Math.min(relX - 5, $("div#content").width() - 200)}px`, top: `${relY + 10}px`}).show();
				// Show annotation
				if ( !$(`annotation#${event.target.id}`).length ) {
					// If annotation box does not exist for this highlight, create it
					let [currentArticle, articleText, i, isCaselaw] = getQuoteFromHighlight(event.target);
					let annotationText = "";
					if (isCaselaw) {
						// Case-law highlights don't use article text keys; annotation is in the caselaw storage
						// For now, annotations on case-law highlights are not stored (only color)
						annotationText = "";
					} else {
						annotationText = ctx.highlights.quotes[articleText][i]?.annotation || "";
					}
					const annotation = document.createElement("annotation");
					annotation.id = event.target.id;
					annotation.className = event.target.classList[0];
					annotation.contentEditable = "true";
					renderAnnotation(annotation, annotationText);
					document.querySelector("div#content").appendChild(annotation);
				}
				$(`annotation#${event.target.id}`).css({left: `${Math.min(relX - 5, $("div#content").width() - 200)}px`, top: `${relY - 130}px`}).show();
			}
			else if (event.target.nodeName == "A") {
				// Activate the link;
				if (event.target.closest("annotation")) {
					event.preventDefault();
					event.stopPropagation();
				} else {
					openLink(event.target.href);
				}
			}
			else if (event.target.nodeName == "SPAN" && event.target.classList.contains("bookmark")) {
				// Click on bookmark
				let currentArticleElem = $(event.target).parents(".article")[0];
				let currentArticle = currentArticleElem.id;
				// let articleText = $(`div#toc a#${currentArticle.slice(7)}_anchor`).text();
				let articleText = ctx.findObjectById(ctx.act, currentArticle.slice(7)).text;
				if (currentArticleElem.classList.contains("bookmark")) {
					// Remove bookmark from this article
					currentArticleElem.classList.remove("bookmark");
					delete ctx.highlights.quotes.bookmarks[articleText];
					await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
				}
				else {
					// Add bookmark to this article
					currentArticleElem.classList.add("bookmark");
					ctx.highlights.quotes.bookmarks = ctx.highlights.quotes.bookmarks || {};
					ctx.highlights.quotes.bookmarks[articleText] = true;
					await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
				}
				updateBookmarkBar();
			}
			else if (!event.target.closest("annotation")) {
				// else erase highlight selection, hide annotation and toolbar
				ctx.currentRange = null;
				ctx.currentArticle = null;
				ctx.highlights.selected.forEach( async function(h) {
					// Hide border around selected highlight
					$(h).css({border: ""});
					// Hide annotation box
					$(`annotation#${h.id}`).hide();
					// Analyze and save content of annotation box
					let [currentArticle, articleText, i, isCaselaw] = getQuoteFromHighlight(h);
					if (isCaselaw) {
						// For case-law highlights, save annotation via caselaw module
						let currentAnnotation = $(`annotation#${h.id}`).text() || "";
						if (currentAnnotation) {
							await ctx.updateCaselawHighlight(h, { annotation: currentAnnotation });
							h.classList.add("annotated");
						} else {
							await ctx.updateCaselawHighlight(h, { annotation: undefined });
							h.classList.remove("annotated");
						}
					} else {
						let previousAnnotation = ctx.highlights.quotes[articleText][i].annotation || "";
						let currentAnnotation = $(`annotation#${h.id}`).text() || "";
						if ( currentAnnotation != previousAnnotation ) {
							if (currentAnnotation) {
								let annotation = $(`annotation#${h.id}`).text()
								ctx.highlights.quotes[articleText][i].annotation = annotation;
								renderAnnotation(document.querySelector(`annotation#${h.id}`), annotation);
								h.classList.add("annotated");
							}
							else {
								h.classList.remove("annotated");
								delete ctx.highlights.quotes[articleText][i].annotation;
							}
							await ctx.setStorage("highlights-" + ctx.act.eli, ctx.highlights.quotes);
						}
					}
				});
				ctx.highlights.selected = [];
				$("div#toolbar").hide();
			}
		}
	}

	function updateBookmarkBar() {
		const bookmarks = document.querySelectorAll("div.article.bookmark");
		if (!bookmarks.length) {
			document.querySelector("div#bookmark-bar").style.display = "none";
			return
		}
		document.querySelector("div#bookmark-bar").style.display = "block";
		const items = document.querySelector("div#bookmark-bar div#items");
		items.replaceChildren();
		for (const b of bookmarks) {
			const node = b.id.split("_")[1];
			// const title = document.querySelector("li#" + node).textContent;
			const title = ctx.findObjectById(ctx.act, node).text;
			const item = document.createElement("div");
			const bookmark = document.createElement("span");
			bookmark.className = "bookmark";
			const label = document.createElement("span");
			label.className = "item";
			label.setAttribute("target", b.id);
			label.textContent = title;
			item.append(bookmark, label);
			items.appendChild(item);
		}
	}

	return { manageHighlights, updateBookmarkBar };
};
