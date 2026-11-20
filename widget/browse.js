/* Browse panel: queue, playlists, search, devices and radio.
   Loaded after app.js and shares its globals (api, sp, mock, S, say, schedule...). */

var panel = {
	node: $("panel"),
	row: $("panel-row"),
	kb: $("kb"),
	field: $("search-field"),
	tab: "queue",
	query: "",
	results: null,
	cache: {},
	ticket: 0
};

var SVG_ADD = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
var SVG_RADIO =
	'<svg class="line" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5"/>' +
	'<path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>';
var DEVICE_ART =
	"data:image/svg+xml," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>'
	);

/* ---------- Spotify objects -> cards ---------- */

function pickImage(images) {
	// Spotify lists images largest first; the second one (~300px) is enough for a card.
	return images && images.length ? images[Math.min(1, images.length - 1)].url : "";
}

function trackItem(t) {
	var artists = t.artists || [];
	return {
		kind: "track",
		uri: t.uri,
		name: t.name || "",
		sub:
			artists
				.map(function (a) {
					return a.name;
				})
				.join(", ") || (t.show && t.show.name) || "",
		art: pickImage((t.album && t.album.images) || t.images),
		artistId: artists.length ? artists[0].id : "",
		artistName: artists.length ? artists[0].name : ""
	};
}

function contextItem(kind, o) {
	return {
		kind: kind,
		uri: o.uri,
		name: o.name || "",
		sub:
			kind === "album" && o.artists && o.artists.length
				? o.artists[0].name
				: kind === "playlist" && o.owner && o.owner.display_name
					? o.owner.display_name
					: S[{ artist: "Artist", album: "Album", playlist: "Playlist" }[kind]],
		art: pickImage(o.images),
		artistId: kind === "artist" ? o.id : "",
		artistName: kind === "artist" ? o.name : ""
	};
}

function present(list) {
	return ((list && list.items) || []).filter(function (o) {
		return o && o.uri;
	});
}

async function getJson(path) {
	var r = await api("GET", path);
	if (!r.ok) {
		throw new Error(r.status === 403 ? "scope" : "http");
	}
	return r.json();
}

/* ---------- loaders ---------- */

var loaders = {
	queue: async function () {
		if (mock) {
			return mock.tracks.map(function (t, i) {
				var x = mock.tracks[(mock.index + i) % mock.tracks.length];
				return { kind: "track", uri: "mock:" + x.id, name: x.title, sub: x.artist, art: x.art, artistName: x.artist };
			});
		}
		var j = await getJson("/me/player/queue");
		var items = [];
		if (j.currently_playing) {
			items.push(trackItem(j.currently_playing));
		}
		(j.queue || []).forEach(function (t) {
			if (t && t.uri) {
				items.push(trackItem(t));
			}
		});
		return items;
	},

	playlists: async function () {
		if (mock) {
			return mock.playlists.map(function (p) {
				return { kind: "playlist", uri: p.uri, name: p.name, sub: "Spotify", art: p.art };
			});
		}
		var out = [];
		var path = "/me/playlists?limit=50";
		for (var page = 0; page < 4 && path; page++) {
			var j = await getJson(path);
			present(j).forEach(function (p) {
				out.push(contextItem("playlist", p));
			});
			path = j.next && j.next.indexOf(API) === 0 ? j.next.slice(API.length) : null;
		}
		return out;
	},

	devices: async function () {
		if (mock) {
			return [
				{ kind: "device", id: "a", name: "PC", sub: "Computer", art: DEVICE_ART, current: true },
				{ kind: "device", id: "b", name: "Salon", sub: "Speaker", art: DEVICE_ART }
			];
		}
		var j = await getJson("/me/player/devices");
		return (j.devices || []).map(function (d) {
			return { kind: "device", id: d.id, name: d.name, sub: d.type || "", art: DEVICE_ART, current: !!d.is_active };
		});
	}
};

async function searchSpotify(query) {
	if (mock) {
		var q = query.toLowerCase();
		return loaders
			.queue()
			.then(function (tracks) {
				return loaders.playlists().then(function (lists) {
					return tracks.concat(lists);
				});
			})
			.then(function (all) {
				return all.filter(function (x) {
					return (x.name + " " + x.sub).toLowerCase().indexOf(q) >= 0;
				});
			});
	}
	var j = await getJson("/search?type=track,artist,album,playlist&limit=10&q=" + encodeURIComponent(query));
	return present(j.tracks)
		.map(trackItem)
		.concat(
			present(j.artists)
				.slice(0, 5)
				.map(function (o) {
					return contextItem("artist", o);
				}),
			present(j.albums)
				.slice(0, 6)
				.map(function (o) {
					return contextItem("album", o);
				}),
			present(j.playlists)
				.slice(0, 6)
				.map(function (o) {
					return contextItem("playlist", o);
				})
		);
}

/* ---------- playback actions ---------- */

async function play(body, quiet) {
	if (mock) {
		mockLoad(mock.index + 1);
		sp.playing = true;
		sp.contextUri = body.context_uri || "";
		render();
		return true;
	}
	lastCmdAt = Date.now();
	var ok = false;
	var problem = "Spotify unreachable";
	try {
		var r = await api("PUT", "/me/player/play", body);
		if (r.status === 404) {
			// No active device: start on the first one Spotify knows about.
			var d = await api("GET", "/me/player/devices");
			var devices = d.ok ? (await d.json()).devices || [] : [];
			if (devices.length) {
				r = await api("PUT", "/me/player/play?device_id=" + encodeURIComponent(devices[0].id), body);
			} else {
				problem = "Open Spotify on a device first";
			}
		}
		ok = r.ok;
		if (r.status === 403) {
			problem = "Spotify Premium required for this control";
		}
	} catch (e) {}
	if (!ok && !quiet) {
		say(problem);
	}
	lastCmdAt = Date.now();
	schedule(900);
	return ok;
}

async function addToQueue(item) {
	if (!mock) {
		try {
			var r = await api("POST", "/me/player/queue?uri=" + encodeURIComponent(item.uri));
			if (!r.ok) {
				say(r.status === 403 ? "Spotify Premium required for this control" : "Open Spotify on a device first");
				return;
			}
		} catch (e) {
			say("Spotify unreachable");
			return;
		}
	}
	delete panel.cache.queue;
	say("Added to queue");
}

async function jumpInQueue(items, index) {
	if (index === 0) {
		return;
	}
	var context = sp ? sp.contextUri : "";
	var ok = false;
	if (/^spotify:(playlist|album):/.test(context)) {
		ok = await play({ context_uri: context, offset: { uri: items[index].uri } }, true);
	}
	if (!ok) {
		ok = await play({
			uris: items.slice(index).map(function (x) {
				return x.uri;
			})
		});
	}
	if (ok) {
		setTimeout(function () {
			if (!panel.node.hidden && panel.tab === "queue") {
				refreshTab("queue");
			}
		}, 1500);
	}
}

async function useDevice(item) {
	if (!mock) {
		try {
			var r = await api("PUT", "/me/player", { device_ids: [item.id] });
			if (!r.ok) {
				say(r.status === 403 ? "Spotify Premium required for this control" : "Spotify unreachable");
				return;
			}
		} catch (e) {
			say("Spotify unreachable");
			return;
		}
	}
	lastCmdAt = Date.now();
	schedule(900);
	closePanel();
}

/* Spotify's Web API has no "start radio" call. First look for the ready-made
   "<name> Radio" playlist; otherwise build a mix from the artist and its genres. */
async function startRadio(seed) {
	if (!seed || !seed.name) {
		return;
	}
	say("Starting radio");
	if (mock) {
		closePanel();
		return play({});
	}
	try {
		var names = seed.kind === "track" && seed.artistName ? [seed.name, seed.artistName] : [seed.name];
		for (var n = 0; n < names.length; n++) {
			var wanted = names[n].toLowerCase();
			var found = present((await getJson("/search?type=playlist&limit=10&q=" + encodeURIComponent(names[n] + " Radio"))).playlists).filter(function (p) {
				var name = (p.name || "").toLowerCase();
				return name.indexOf("radio") >= 0 && name.indexOf(wanted.slice(0, 14)) >= 0;
			});
			found.sort(function (a, b) {
				return (b.owner && b.owner.id === "spotify" ? 1 : 0) - (a.owner && a.owner.id === "spotify" ? 1 : 0);
			});
			if (found.length && (await play({ context_uri: found[0].uri }, true))) {
				closePanel();
				return;
			}
		}

		var artist = seed.artistName || seed.name;
		var queries = ['artist:"' + artist + '"'];
		if (seed.artistId) {
			try {
				((await getJson("/artists/" + seed.artistId)).genres || []).slice(0, 2).forEach(function (g) {
					queries.push('genre:"' + g + '"');
				});
			} catch (e) {}
		}
		var uris = [];
		for (var i = 0; i < queries.length; i++) {
			present((await getJson("/search?type=track&limit=10&q=" + encodeURIComponent(queries[i]))).tracks).forEach(function (t) {
				if (uris.indexOf(t.uri) < 0 && t.uri !== seed.uri) {
					uris.push(t.uri);
				}
			});
		}
		for (var k = uris.length - 1; k > 0; k--) {
			var s = Math.floor(Math.random() * (k + 1));
			var tmp = uris[k];
			uris[k] = uris[s];
			uris[s] = tmp;
		}
		if (seed.kind === "track") {
			uris.unshift(seed.uri);
		}
		if (uris.length < 3) {
			say("Radio unavailable for this title");
			return;
		}
		if (await play({ uris: uris })) {
			closePanel();
		}
	} catch (e) {
		say("Radio unavailable for this title");
	}
}

/* ---------- rendering ---------- */

function actionButton(svg, run) {
	var b = document.createElement("button");
	b.className = "act";
	b.innerHTML = svg;
	b.addEventListener("click", function (e) {
		e.stopPropagation();
		run();
	});
	return b;
}

function card(item, onTap) {
	var node = document.createElement("div");
	var current = item.current || (sp && (sp.uri === item.uri || sp.contextUri === item.uri));
	node.className = "pl " + item.kind + (item.kind === "artist" ? " round" : "") + (current ? " current" : "");

	var cover = document.createElement("div");
	cover.className = "cover";
	if (item.art) {
		cover.style.backgroundImage = 'url("' + item.art + '")';
	}
	if (item.kind === "track" || item.kind === "artist") {
		var acts = document.createElement("div");
		acts.className = "acts";
		if (item.kind === "track" && panel.tab !== "queue") {
			acts.appendChild(
				actionButton(SVG_ADD, function () {
					addToQueue(item);
				})
			);
		}
		acts.appendChild(
			actionButton(SVG_RADIO, function () {
				startRadio(item);
			})
		);
		cover.appendChild(acts);
	}

	var name = document.createElement("div");
	name.className = "name";
	name.textContent = item.name;
	var sub = document.createElement("div");
	sub.className = "sub";
	sub.textContent = item.sub || "";

	node.appendChild(cover);
	node.appendChild(name);
	node.appendChild(sub);
	node.addEventListener("click", onTap);
	return node;
}

var EMPTY = { queue: "Queue is empty", playlists: "No playlists found", search: "No results", devices: "No device found" };

function fill(items, message) {
	panel.row.textContent = "";
	panel.row.scrollLeft = 0;
	if (message || !items || !items.length) {
		var empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = message || (items ? S[EMPTY[panel.tab]] : "…");
		panel.row.appendChild(empty);
		return;
	}
	var tab = panel.tab;
	items.forEach(function (item, index) {
		panel.row.appendChild(
			card(item, function () {
				if (tab === "queue") {
					jumpInQueue(items, index);
				} else if (item.kind === "device") {
					useDevice(item);
				} else {
					play(item.kind === "track" ? { uris: [item.uri] } : { context_uri: item.uri });
					closePanel();
				}
			})
		);
	});
}

function failure(e) {
	return S[e && e.message === "scope" ? "Playlists unavailable, generate a new token" : "Spotify unreachable"];
}

function refreshTab(tab) {
	var ticket = ++panel.ticket;
	loaders[tab]().then(
		function (items) {
			panel.cache[tab] = items;
			if (ticket === panel.ticket && panel.tab === tab) {
				fill(items);
			}
		},
		function (e) {
			if (ticket === panel.ticket && panel.tab === tab && !panel.cache[tab]) {
				fill(null, failure(e));
			}
		}
	);
}

function showTab(tab) {
	panel.tab = tab;
	panel.ticket++;
	panel.node.hidden = false;
	panel.node.classList.toggle("search", tab === "search");
	Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
		b.textContent = S[{ queue: "Queue", playlists: "Playlists", search: "Search", devices: "Devices" }[b.dataset.tab]];
		b.classList.toggle("on", b.dataset.tab === tab);
	});
	if (tab === "search") {
		renderField();
		setTyping(!panel.results);
		if (panel.results) {
			fill(panel.results);
		}
		return;
	}
	setTyping(false);
	fill(panel.cache[tab] || null);
	refreshTab(tab);
}

function closePanel() {
	panel.node.hidden = true;
	panel.ticket++;
}

/* ---------- search field and on-screen keyboard ---------- */

var LAYOUTS = {
	azerty: ["1234567890", "azertyuiop", "qsdfghjklm", "wxcvbn'-"],
	qwerty: ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm-"]
};

function renderField() {
	panel.field.textContent = panel.query || S["Type your search"];
	panel.field.classList.toggle("placeholder", !panel.query);
}

function typeKey(key) {
	if (key === "back") {
		panel.query = panel.query.slice(0, -1);
	} else if (key === "go") {
		return runSearch();
	} else if (panel.query.length < 60) {
		panel.query += key;
	}
	renderField();
}

function keyButton(label, key, extra) {
	var b = document.createElement("button");
	b.className = "key" + (extra ? " " + extra : "");
	b.textContent = label;
	b.addEventListener("click", function () {
		typeKey(key);
	});
	return b;
}

function buildKeyboard() {
	var layout = setting("keyboardLayout", "azerty");
	if (layout && typeof layout === "object") {
		layout = layout.key;
	}
	var rows = LAYOUTS[layout] || LAYOUTS.azerty;
	panel.kb.textContent = "";
	rows.forEach(function (letters, r) {
		var row = document.createElement("div");
		row.className = "kb-row";
		letters.split("").forEach(function (ch) {
			row.appendChild(keyButton(ch, ch));
		});
		if (r === rows.length - 1) {
			row.appendChild(keyButton("␣", " ", "wide"));
			row.appendChild(keyButton("⌫", "back"));
			row.appendChild(keyButton("OK", "go", "go"));
		}
		panel.kb.appendChild(row);
	});
}

function setTyping(on) {
	panel.node.classList.toggle("typing", on);
	if (on) {
		buildKeyboard();
	}
}

function runSearch() {
	var query = panel.query.trim();
	if (!query) {
		return;
	}
	setTyping(false);
	fill(null);
	var ticket = ++panel.ticket;
	searchSpotify(query).then(
		function (items) {
			panel.results = items;
			if (ticket === panel.ticket && panel.tab === "search") {
				fill(items);
			}
		},
		function (e) {
			if (ticket === panel.ticket && panel.tab === "search") {
				fill(null, failure(e));
			}
		}
	);
}

panel.field.addEventListener("click", function () {
	setTyping(true);
});

// A physical keyboard works too when the widget has focus.
document.addEventListener("keydown", function (e) {
	if (panel.node.hidden || panel.tab !== "search" || !panel.node.classList.contains("typing")) {
		return;
	}
	if (e.key === "Enter") {
		typeKey("go");
	} else if (e.key === "Backspace") {
		typeKey("back");
	} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
		typeKey(e.key);
	} else {
		return;
	}
	e.preventDefault();
});

/* ---------- wiring ---------- */

Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
	b.addEventListener("click", function () {
		showTab(b.dataset.tab);
	});
});

$("btn-browse").addEventListener("click", function () {
	showTab(panel.tab);
});
$("panel-close").addEventListener("click", closePanel);
$("panel-radio").addEventListener("click", function () {
	if (sp) {
		startRadio({ kind: "track", uri: sp.uri, name: sp.title, artistName: sp.artist.split(",")[0] });
	}
});
