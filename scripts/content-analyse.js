window.BJ = window.BJ || {};
window.BJ.analyseModule = function(ctx) {

	const HEADINGS_TYPE = ctx.HEADINGS_TYPE;

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
						ctx.headingsWhoseTypeNeedsToBeDefined.push(heading);
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
			else if (ctx.headingsWhoseTypeNeedsToBeDefined.length) {
				for (let h of ctx.headingsWhoseTypeNeedsToBeDefined) {
					h.type = heading.type;
				}
				ctx.headingsWhoseTypeNeedsToBeDefined = [];
			}
			heading.text = n.textContent.trimStart();
			heading.content = n.textContent;
			heading.titleOngoing = false;
			heading.children = [];
			if (!currentParents.length) {
				// Node must be directly attached to root
				ctx.act.content.push(heading);
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
						ctx.act.content.push(heading);
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
						ctx.act.content.push(heading);
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
			const ARTICLE_REGEX = /Art(\.|icle)\s?[LR]?([IVX]+|\d+(\w+)?)((\.|\/|:|-)\d+)?((\.|\/|:|-)\d+)?\.(.+[a-zéèA-Z]$)?/
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
				// Post-processing: reclassify lone i), v), x) as letters instead of roman numerals
				// i) is roman only if followed by ii); v) is roman only if preceded by iv); x) is roman only if preceded by ix)
				for (let i = 0; i < content.length; i++) {
					if (contentIndent[i].type == 4) {
						let num = contentIndent[i].numbering.replace(/<[^>]+>/g, "").trim();
						let isLoneRoman = false;
						if (num.match(/^i[).]/i) && !num.match(/^i[ivx]/i)) {
							// i) is roman only if followed by ii)
							let hasFollowup = false;
							for (let j = i + 1; j < content.length; j++) {
								if (contentIndent[j].type == 4) {
									let n2 = contentIndent[j].numbering.replace(/<[^>]+>/g, "").trim();
									if (n2.match(/^ii[).]/i)) { hasFollowup = true; }
									break;
								}
							}
							if (!hasFollowup) isLoneRoman = true;
						}
						else if (num.match(/^v[).]/i) && !num.match(/^vi/i)) {
							// v) is roman only if preceded by iv)
							let hasPreceding = false;
							for (let j = i - 1; j >= 0; j--) {
								if (contentIndent[j].type == 4) {
									let n2 = contentIndent[j].numbering.replace(/<[^>]+>/g, "").trim();
									if (n2.match(/^iv[).]/i)) { hasPreceding = true; }
									break;
								}
							}
							if (!hasPreceding) isLoneRoman = true;
						}
						else if (num.match(/^x[).]/i) && !num.match(/^x[ivxlc]/i)) {
							// x) is roman only if preceded by ix)
							let hasPreceding = false;
							for (let j = i - 1; j >= 0; j--) {
								if (contentIndent[j].type == 4) {
									let n2 = contentIndent[j].numbering.replace(/<[^>]+>/g, "").trim();
									if (n2.match(/^ix[).]/i)) { hasPreceding = true; }
									break;
								}
							}
							if (!hasPreceding) isLoneRoman = true;
						}
						if (isLoneRoman) {
							contentIndent[i].type = 3; // Reclassify as letter
						}
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
				n.content = content.map((el, i) => 
					`<div style='padding-left: ${contentIndent[i].type * 20}px;'>`
					+ `${contentIndent[i].subparCount > 1 ? "<span class='subpar'>Al. " + contentIndent[i].subparCount + "</span>" : ""}${el}</div>`
				).join("") + "<br>";
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
				ctx.headingsWhoseTypeNeedsToBeDefined.push(heading);
				currentParents.push(heading);
				ctx.act.content.push(heading);
			}
			return (article);
		}
		// Main analyseContent
		ctx.addLoading("Analysing content of the act");
		document.querySelector("div#list-title-3 h2").remove();
		let contentNodes = Array.from(document.querySelector("div#list-title-3").childNodes);
		// Also correct p elements which contain articles 
		const WRONG_LAST_NODENAME = ["ERRATUM,M.B.", "I", "BR&GT;<BR", "L", "P", "AR"];
		let i = 0;
		do {
			// Using do ... while instead of forEach because the number of the elements of the array is affected by the loop
			let el = contentNodes[i];
			if (WRONG_LAST_NODENAME.some(w => el.nodeName == w)) { 
				console.log("Correcting wrong structure of the page at element", i, el);
				let newArray = Array.from ( el.childNodes );
				contentNodes.splice(i, 1, ...newArray );
			}
			i++;
		} while (i != contentNodes.length);
		// Anlyse each node depending on their type
		for (let [index, n] of contentNodes.entries()) {
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
						// Correction for Art. 1
						if (!lastNode.text && n.textContent.startsWith("Article")) {lastNode.text = "Art. ";}
					}
					else {
						// Test if a heading was erroneously inserted as the end of an article (wrong subdivision)
						if ( (text.trim()[0] != "§")
							&& ( n.nextSibling?.nextSibling?.nodeName == "BR" )
							&& ( HEADINGS_TYPE.some(el => text.toLowerCase().trim().startsWith(el)) )
						) {
							// This may be a heading hidden in the article content
							console.log(`Hidden heading possibly found: ${text}`);
							if ( text.split(" ")?.[1].match(/^[\dIVXL]+\./) ) { // Avoid recognising as heading something like "partie concernée"
								console.log("Added as heading");
								lastNode.content += "<br><br>";
								beautify(lastNode);
								n.textContent = n.textContent.trim();
								analyseHeading(n);
							}
							else {
								// This is ordinary text to be added to the content of the article
								console.log("No heading after all")
								lastNode.content += n.textContent.replace(/</g, "&lt;");
							}
						}
						else {
							// This is ordinary text to be added to the content of the article
							lastNode.content += n.textContent.replace(/</g, "&lt;");
						};
					}
				}
				else {
					// Last node was a heading
					// Test if a heading was erroneously inserted as the content of a heading title (wrong subdivision)
					let m = text.match(/[\w\-]+\s\d(\w+)?\.\s.+/);
					if (m && m.index > 0 && HEADINGS_TYPE.some(el => m[0].toLowerCase().startsWith(el))) {
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
			const bookmark = n.type == "article" ? "<span class='bookmark'></span>" : "";
			content += `<div id="anchor_${n.id}" class="${n.level}">${bookmark}${n.content}</div>`;
			if (n.children?.length) {
				content += buildContent(n.children);
			}
		}
		return content;
	}

	return { analyseContent, buildContent };
};
