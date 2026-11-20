/* Classic (non-module, non-strict) script on purpose: iCUE looks up the bare
   globals icueEvents / pluginMediadataproviderEvents and injects settings as globals. */

var inICUE = typeof iCUE_initialized !== "undefined";
var API = "https://api.spotify.com/v1";
var TOKEN_URL = "https://accounts.spotify.com/api/token";
var LS_KEY = "spotifyplayer.refresh";

var S = {
	"Nothing playing": "Nothing playing",
	"Start playback in Spotify": "Start playback in Spotify",
	"Spotify sign-in expired, generate a new token": "Spotify sign-in expired, generate a new token",
	"Spotify unreachable": "Spotify unreachable",
	"Spotify Premium required for this control": "Spotify Premium required for this control",
	"Playlists": "Playlists",
	"No playlists found": "No playlists found",
	"Playlists unavailable, generate a new token": "Playlists unavailable, generate a new token",
	"Open Spotify on a device first": "Open Spotify on a device first",
	"Queue": "Queue",
	"Search": "Search",
	"Devices": "Devices",
	"Queue is empty": "Queue is empty",
	"No results": "No results",
	"Type your search": "Type your search",
	"No device found": "No device found",
	"Added to queue": "Added to queue",
	"Starting radio": "Starting radio",
	"Radio unavailable for this title": "Radio unavailable for this title",
	"Artist": "Artist",
	"Album": "Album",
	"Playlist": "Playlist"
};

function $(id) {
	return document.getElementById(id);
}

var el = {
	body: document.body,
	bg: $("bg"),
	art: $("art-img"),
	title: $("title"),
	artist: $("artist"),
	hint: $("hint"),
	elapsed: $("elapsed"),
	duration: $("duration"),
	shuffle: $("btn-shuffle"),
	repeat: $("btn-repeat"),
	like: $("btn-like")
};

/* ---------- state ---------- */

var media = { title: "", artist: "", art: "", playing: false };
var sp = null; // Spotify playback snapshot, null when the Web API has nothing to show
var spStatus = "off"; // off | ok | auth | error
var flash = { text: "", until: 0 };
var shownArt = null;
var lastCmdAt = 0;

/* ---------- settings ---------- */

function setting(name, fallback) {
	var v = window[name];
	return v === undefined || v === null ? fallback : v;
}

function creds() {
	var id = String(setting("spotifyClientId", "")).trim();
	var seed = String(setting("spotifyRefreshToken", "")).trim();
	return id && seed ? { id: id, seed: seed, key: id + "|" + seed } : null;
}

/* ---------- Windows media session (iCUE Media plugin) ---------- */

function mediaPlugin() {
	if (typeof pluginMediadataprovider_initialized === "undefined" || !pluginMediadataprovider_initialized) {
		return null;
	}
	return (window.plugins && window.plugins.Mediadataprovider) || null;
}

var mediaReq = { next: 1, pending: {}, wired: false };

function mediaGet(m, prop) {
	if (m[prop] !== undefined) {
		return Promise.resolve(m[prop]);
	}
	var getter = m["get" + prop.charAt(0).toUpperCase() + prop.slice(1)];
	if (typeof getter !== "function") {
		return Promise.resolve(undefined);
	}
	return new Promise(function (resolve) {
		var id = mediaReq.next++;
		mediaReq.pending[id] = resolve;
		setTimeout(function () {
			if (mediaReq.pending[id]) {
				delete mediaReq.pending[id];
				resolve(undefined);
			}
		}, 3000);
		getter.call(m, id);
	});
}

function refreshMedia() {
	var m = mediaPlugin();
	if (!m) {
		return;
	}
	Promise.all([
		mediaGet(m, "songName"),
		mediaGet(m, "artist"),
		mediaGet(m, "thumbnail"),
		mediaGet(m, "isPlaying")
	]).then(function (v) {
		media = { title: v[0] || "", artist: v[1] || "", art: v[2] || "", playing: !!v[3] };
		render();
	});
}

function onMediaInitialized() {
	var m = mediaPlugin();
	if (!m || mediaReq.wired) {
		return;
	}
	mediaReq.wired = true;
	if (m.asyncResponse) {
		m.asyncResponse.connect(function (id, value) {
			var resolve = mediaReq.pending[id];
			if (resolve) {
				delete mediaReq.pending[id];
				resolve(value);
			}
		});
	}
	["songName", "artist", "album", "thumbnail", "isPlaying"].forEach(function (p) {
		if (m[p + "Changed"]) {
			m[p + "Changed"].connect(refreshMedia);
		}
	});
	refreshMedia();
}

function mediaCommand(kind) {
	var m = mediaPlugin();
	if (!m) {
		return false;
	}
	var fn = { toggle: "triggerPlayPause", next: "triggerNextTrack", prev: "triggerPreviousTrack" }[kind];
	if (!fn || typeof m[fn] !== "function") {
		return false;
	}
	m[fn]();
	return true;
}

/* ---------- Spotify Web API ---------- */

var auth = { key: "", access: "", exp: 0, deadKey: "", backoffUntil: 0 };

function storedRefresh(c) {
	try {
		var s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
		if (s && s.key === c.key && s.current) {
			return s.current;
		}
	} catch (e) {}
	return c.seed;
}

function storeRefresh(c, token) {
	try {
		localStorage.setItem(LS_KEY, JSON.stringify({ key: c.key, current: token }));
	} catch (e) {}
}

function requestToken(c, refresh) {
	return fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: c.id })
	});
}

async function accessToken(c) {
	if (auth.key === c.key && auth.access && Date.now() < auth.exp - 30000) {
		return auth.access;
	}
	var refresh = storedRefresh(c);
	var r = await requestToken(c, refresh);
	if (!r.ok && r.status < 500 && refresh !== c.seed) {
		// The rotated token we kept is no longer valid; the one typed in settings may be newer.
		refresh = c.seed;
		r = await requestToken(c, refresh);
	}
	if (!r.ok) {
		if (r.status === 400 || r.status === 401) {
			auth.deadKey = c.key;
			try {
				localStorage.removeItem(LS_KEY);
			} catch (e) {}
			throw new Error("auth");
		}
		throw new Error("token " + r.status);
	}
	var j = await r.json();
	auth.key = c.key;
	auth.access = j.access_token;
	auth.exp = Date.now() + (j.expires_in || 3600) * 1000;
	if (j.refresh_token) {
		storeRefresh(c, j.refresh_token);
	}
	return auth.access;
}

async function api(method, path, body) {
	var c = creds();
	if (!c) {
		throw new Error("off");
	}
	for (var attempt = 0; attempt < 2; attempt++) {
		var token = await accessToken(c);
		var options = { method: method, headers: { Authorization: "Bearer " + token } };
		if (body) {
			options.headers["Content-Type"] = "application/json";
			options.body = JSON.stringify(body);
		}
		var r = await fetch(API + path, options);
		if (r.status === 401 && attempt === 0) {
			auth.access = "";
			continue;
		}
		if (r.status === 429) {
			var wait = parseInt(r.headers.get("Retry-After") || "5", 10);
			auth.backoffUntil = Date.now() + (isNaN(wait) ? 5 : wait) * 1000;
		}
		return r;
	}
}

function snapshot(d) {
	var item = d && d.item;
	if (!item) {
		return null;
	}
	var images = (item.album && item.album.images) || item.images || [];
	var device = d.device || {};
	return {
		id: item.id,
		uri: item.uri,
		contextUri: (d.context && d.context.uri) || "",
		isTrack: item.type === "track",
		title: item.name || "",
		artist: item.artists
			? item.artists
					.map(function (a) {
						return a.name;
					})
					.join(", ")
			: (item.show && item.show.name) || "",
		art: images.length ? images[0].url : "",
		playing: !!d.is_playing,
		progress: d.progress_ms || 0,
		duration: item.duration_ms || 0,
		stamp: Date.now(),
		shuffle: !!d.shuffle_state,
		repeat: d.repeat_state || "off",
		volume: device.supports_volume === false || device.volume_percent == null ? null : device.volume_percent,
		liked: null
	};
}

var pollTimer = 0;

function schedule(ms) {
	clearTimeout(pollTimer);
	pollTimer = setTimeout(poll, ms);
}

async function poll() {
	var c = creds();
	if (!c) {
		sp = null;
		spStatus = "off";
		render();
		return;
	}
	if (auth.deadKey === c.key) {
		sp = null;
		spStatus = "auth";
		render();
		return;
	}
	if (Date.now() < auth.backoffUntil) {
		return schedule(auth.backoffUntil - Date.now() + 250);
	}
	var started = Date.now();
	try {
		var r = await api("GET", "/me/player?additional_types=episode");
		if (started < lastCmdAt) {
			return schedule(700); // answer predates a command the user just sent
		}
		if (r.status === 200) {
			var next = snapshot(await r.json());
			if (next && sp && sp.id === next.id) {
				next.liked = sp.liked;
			}
			var changed = next && (!sp || sp.id !== next.id);
			sp = next;
			spStatus = "ok";
			if (changed && next.isTrack) {
				checkLiked(next);
			}
		} else if (r.status === 204) {
			sp = null;
			spStatus = "ok";
		} else if (r.status !== 429) {
			spStatus = "error";
		}
	} catch (e) {
		sp = null;
		spStatus = e.message === "auth" ? "auth" : "error";
		if (spStatus === "auth") {
			render();
			return;
		}
	}
	render();
	schedule(sp ? (sp.playing ? 3000 : 6000) : 10000);
}

async function checkLiked(track) {
	try {
		var r = await api("GET", "/me/library/contains?uris=" + encodeURIComponent(track.uri));
		if (!r.ok) {
			r = await api("GET", "/me/tracks/contains?ids=" + track.id);
		}
		if (!r.ok) {
			return;
		}
		var j = await r.json();
		if (sp && sp.id === track.id) {
			sp.liked = !!j[0];
			render();
		}
	} catch (e) {}
}

async function setLiked(track, liked) {
	var method = liked ? "PUT" : "DELETE";
	var r = await api(method, "/me/library?uris=" + encodeURIComponent(track.uri));
	if (!r.ok) {
		r = await api(method, "/me/tracks?ids=" + track.id);
	}
	return r.ok;
}

/* ---------- commands ---------- */

function position() {
	if (!sp) {
		return 0;
	}
	var p = sp.progress + (sp.playing ? Date.now() - sp.stamp : 0);
	return Math.max(0, Math.min(sp.duration || p, p));
}

function say(key) {
	flash = { text: S[key] || key, until: Date.now() + 4000 };
	var toast = $("toast");
	toast.textContent = flash.text;
	toast.hidden = false;
	render();
	setTimeout(function () {
		if (Date.now() >= flash.until) {
			toast.hidden = true;
		}
		render();
	}, 4100);
}

async function command(kind, arg) {
	var transport = kind === "toggle" || kind === "next" || kind === "prev";
	if (!sp) {
		if (transport) {
			mediaCommand(kind);
		}
		return;
	}

	// Show the result immediately; the next poll confirms or corrects it.
	var before = Object.assign({}, sp);
	var path;
	if (kind === "toggle") {
		path = sp.playing ? "PUT /me/player/pause" : "PUT /me/player/play";
		sp.progress = position();
		sp.playing = !sp.playing;
	} else if (kind === "next") {
		path = "POST /me/player/next";
	} else if (kind === "prev") {
		path = "POST /me/player/previous";
	} else if (kind === "seek") {
		sp.progress = Math.round(arg);
		path = "PUT /me/player/seek?position_ms=" + sp.progress;
	} else if (kind === "shuffle") {
		sp.shuffle = !sp.shuffle;
		path = "PUT /me/player/shuffle?state=" + sp.shuffle;
	} else if (kind === "repeat") {
		sp.repeat = { off: "context", context: "track", track: "off" }[sp.repeat] || "off";
		path = "PUT /me/player/repeat?state=" + sp.repeat;
	} else if (kind === "volume") {
		sp.volume = Math.round(arg);
		path = "PUT /me/player/volume?volume_percent=" + sp.volume;
	} else if (kind === "like") {
		sp.liked = !sp.liked;
	}
	sp.stamp = Date.now();
	lastCmdAt = Date.now();
	render();

	if (mock) {
		return mockCommand(kind);
	}

	try {
		var ok;
		if (kind === "like") {
			ok = await setLiked(before, sp.liked);
		} else {
			var parts = path.split(" ");
			var r = await api(parts[0], parts[1]);
			ok = r.ok;
			if (!ok && r.status === 403) {
				say("Spotify Premium required for this control");
			}
		}
		if (!ok) {
			throw new Error("rejected");
		}
	} catch (e) {
		if (sp && sp.id === before.id) {
			sp = before;
			sp.progress = before.progress + (before.playing ? Date.now() - before.stamp : 0);
			sp.stamp = Date.now();
		}
		if (transport) {
			mediaCommand(kind);
		}
		render();
	}
	lastCmdAt = Date.now();
	schedule(kind === "next" || kind === "prev" ? 900 : 600);
}

/* ---------- rendering ---------- */

function clock(ms) {
	var s = Math.floor(ms / 1000);
	var m = Math.floor(s / 60);
	var h = Math.floor(m / 60);
	var ss = String(s % 60).padStart(2, "0");
	return h ? h + ":" + String(m % 60).padStart(2, "0") + ":" + ss : m + ":" + ss;
}

function setArt(url) {
	if (url === shownArt) {
		return;
	}
	shownArt = url;
	el.body.classList.remove("has-art");
	if (!url) {
		el.art.removeAttribute("src");
		return;
	}
	var img = new Image();
	img.onload = function () {
		if (shownArt !== url) {
			return;
		}
		el.art.src = url;
		el.bg.style.backgroundImage = 'url("' + url + '")';
		el.body.classList.add("has-art");
	};
	img.src = url;
}

function renderProgress() {
	if (!sp) {
		return;
	}
	var p = position();
	el.duration.textContent = clock(sp.duration);
	if (!seek.dragging()) {
		el.elapsed.textContent = clock(p);
		seek.set(sp.duration ? p / sp.duration : 0);
	}
}

function render() {
	var cur = sp || media;
	var idle = !cur.title && !cur.artist;
	var c = el.body.classList;

	c.toggle("media-only", !sp);
	c.toggle("has-api", spStatus === "ok");
	c.toggle("idle", idle);
	c.toggle("playing", !!cur.playing);
	c.toggle("art-bg", setting("artworkBackground", true) !== false);
	c.toggle("no-like", !sp || !sp.isTrack || sp.liked === null);
	c.toggle("no-volume", !sp || sp.volume === null);

	el.title.textContent = idle ? S["Nothing playing"] : cur.title;
	el.artist.textContent = idle ? "" : cur.artist;
	setArt(idle ? "" : cur.art);

	var hint = "";
	if (Date.now() < flash.until) {
		hint = flash.text;
	} else if (spStatus === "auth") {
		hint = S["Spotify sign-in expired, generate a new token"];
	} else if (spStatus === "error") {
		hint = S["Spotify unreachable"];
	} else if (idle) {
		hint = S["Start playback in Spotify"];
	}
	el.hint.textContent = hint;

	if (sp) {
		el.shuffle.classList.toggle("on", sp.shuffle);
		el.repeat.classList.toggle("on", sp.repeat !== "off");
		el.repeat.classList.toggle("one", sp.repeat === "track");
		el.like.classList.toggle("on", !!sp.liked);
		if (sp.volume !== null && !vol.dragging()) {
			vol.set(sp.volume / 100);
		}
		renderProgress();
	}
}

function applyAppearance() {
	document.documentElement.style.setProperty("--accent", setting("accentColor", "#1ED760") || "#1ED760");
}

/* ---------- touch sliders ---------- */

function slider(node, onInput, onCommit) {
	var dragging = false;
	var value = 0;

	function apply(v) {
		value = v;
		node.style.setProperty("--value", v);
	}

	function fromEvent(e) {
		var r = node.getBoundingClientRect();
		return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}

	node.addEventListener("pointerdown", function (e) {
		dragging = true;
		node.setPointerCapture(e.pointerId);
		node.classList.add("dragging");
		apply(fromEvent(e));
		onInput(value);
	});
	node.addEventListener("pointermove", function (e) {
		if (dragging) {
			apply(fromEvent(e));
			onInput(value);
		}
	});
	function end(commit) {
		return function () {
			if (!dragging) {
				return;
			}
			dragging = false;
			node.classList.remove("dragging");
			if (commit) {
				onCommit(value);
			}
		};
	}
	node.addEventListener("pointerup", end(true));
	node.addEventListener("pointercancel", end(false));

	return {
		set: function (v) {
			if (!dragging) {
				apply(v);
			}
		},
		dragging: function () {
			return dragging;
		}
	};
}

var seek = slider(
	$("seek"),
	function (v) {
		if (sp) {
			el.elapsed.textContent = clock(v * sp.duration);
		}
	},
	function (v) {
		if (sp) {
			command("seek", v * sp.duration);
		}
	}
);

var vol = slider(
	$("vol"),
	function () {},
	function (v) {
		command("volume", v * 100);
	}
);

[
	["btn-play", "toggle"],
	["btn-next", "next"],
	["btn-prev", "prev"],
	["btn-shuffle", "shuffle"],
	["btn-repeat", "repeat"],
	["btn-like", "like"]
].forEach(function (pair) {
	$(pair[0]).addEventListener("click", function () {
		command(pair[1]);
	});
});

setInterval(renderProgress, 500);

/* ---------- browser preview (outside iCUE): index.html?media shows the media-session mode ---------- */

var mock = null;

function mockArt(a, b) {
	return (
		"data:image/svg+xml," +
		encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1">' +
				'<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>' +
				'<rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="32" r="14" fill="rgba(0,0,0,.35)"/></svg>'
		)
	);
}

function mockLoad(i) {
	var t = mock.tracks[(i + mock.tracks.length) % mock.tracks.length];
	mock.index = mock.tracks.indexOf(t);
	sp = Object.assign(
		{ uri: "mock:" + t.id, isTrack: true, playing: true, progress: 0, stamp: Date.now(), shuffle: false, repeat: "off", volume: 60, liked: false },
		sp ? { shuffle: sp.shuffle, repeat: sp.repeat, volume: sp.volume, playing: sp.playing } : {},
		t
	);
	spStatus = "ok";
	render();
}

function mockCommand(kind) {
	if (kind === "next") {
		mockLoad(mock.index + 1);
	} else if (kind === "prev") {
		mockLoad(mock.index - 1);
	}
}

function startMock() {
	var tracks = [
		{ id: "1", title: "Midnight Boulevard", artist: "The Lanterns", duration: 214000, art: mockArt("#ff5f6d", "#3a1c71") },
		{ id: "2", title: "A Considerably Longer Song Title That Wraps Onto Two Lines (Live at the Old Harbour)", artist: "Paper Kites Orchestra, Ines Morel", duration: 372000, art: mockArt("#11998e", "#1c2a5e") },
		{ id: "3", title: "Soleil d'hiver", artist: "Clara Vasseur", duration: 187000, art: mockArt("#f7971e", "#7a1f3d") }
	];
	if (location.search.indexOf("media") >= 0) {
		media = { title: tracks[0].title, artist: tracks[0].artist, art: tracks[0].art, playing: true };
		render();
		return;
	}
	mock = {
		tracks: tracks,
		index: 0,
		playlists: ["Daily Mix 1", "Focus Flow", "Route de nuit", "Jazz in the Background", "Running 170 BPM", "Chansons françaises", "Lo-fi Beats", "Summer Rewind", "Discover Weekly"].map(function (name, i) {
			return { uri: "mock:playlist:" + i, name: name, art: mockArt("hsl(" + i * 40 + ",70%,55%)", "hsl(" + (i * 40 + 90) + ",60%,25%)") };
		})
	};
	mockLoad(0);
	sp.progress = 61000;
	render();
	setInterval(function () {
		if (sp && sp.playing && position() >= sp.duration) {
			mockLoad(mock.index + 1);
		}
	}, 500);
}

/* ---------- iCUE wiring ---------- */

var lastCredsKey = null;

function onDataUpdated() {
	applyAppearance();
	var c = creds();
	var key = c ? c.key : "";
	if (key !== lastCredsKey) {
		lastCredsKey = key;
		auth.access = "";
		auth.deadKey = "";
		sp = null;
		if (inICUE) {
			schedule(0);
		}
	}
	render();
}

async function onICUEInitialized() {
	if (typeof tr === "function") {
		for (var key in S) {
			try {
				S[key] = (await tr(key)) || S[key];
			} catch (e) {}
		}
	}
	onDataUpdated();
}

icueEvents = {
	onDataUpdated: onDataUpdated,
	onICUEInitialized: onICUEInitialized
};

pluginMediadataproviderEvents = {
	onInitialized: onMediaInitialized
};

applyAppearance();
render();

if (inICUE) {
	if (iCUE_initialized) {
		onICUEInitialized();
	}
	onMediaInitialized();
} else {
	startMock();
}
