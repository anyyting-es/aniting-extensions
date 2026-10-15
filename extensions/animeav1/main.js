const SEARCH_CACHE_MS = 5 * 60 * 1000;

function remember(key) {
    if (typeof $store === "undefined" || !$store) return undefined;
    try {
        const hit = $store.get(key);
        if (hit && hit.value !== undefined && Date.now() - hit.at < SEARCH_CACHE_MS) {
            return hit.value;
        }
    } catch (err) {}
    return undefined;
}

function keep(key, value) {
    if (typeof $store === "undefined" || !$store) return;
    try {
        $store.set(key, { at: Date.now(), value });
    } catch (err) {}
}

const RETRY_BUDGET_MS = 8000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SITE_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "*/*",
    "Accept-Language": "es-ES,es;q=0.9",
    "Referer": "https://animeav1.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
};

const PLAIN_HEADERS = {
    "User-Agent": BROWSER_UA,
};

async function fetchWithRetry(url, retries = 2, headers = SITE_HEADERS) {
    const started = Date.now();
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { timeout: 15, headers });
            if (res.status >= 500 && attempt < retries && Date.now() - started < RETRY_BUDGET_MS) {
                continue;
            }
            return res;
        } catch (err) {
            lastErr = err;
            if (Date.now() - started >= RETRY_BUDGET_MS) break;
        }
    }
    throw lastErr || new Error("No se pudo conectar con " + url);
}

const GENERIC_WORDS = {
    season: true, part: true, cour: true, movie: true, special: true,
    ova: true, ona: true, tv: true, the: true, final: true,
};

const normalizedTitles = {};

function normalize(value) {
    if (!value) return "";
    const cached = normalizedTitles[value];
    if (cached !== undefined) return cached;
    return (normalizedTitles[value] = normalizeUncached(value));
}

function normalizeUncached(value) {
    return value
        .toLowerCase()
        .replace(/[áàäâã]/g, "a")
        .replace(/[éèëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[óòöôõ]/g, "o")
        .replace(/[úùüû]/g, "u")
        .replace(/ñ/g, "n")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
        .trim();
}

function similarity(candidate, wanted) {
    const words = normalize(wanted).split(" ").filter(Boolean);
    const pool = normalize(candidate).split(" ").filter(Boolean);
    if (words.length === 0 || pool.length === 0) return 0;
    let hits = 0;
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const at = pool.indexOf(word);
        if (at !== -1) {
            hits++;
            pool.splice(at, 1);
        }
    }
    return hits / words.length;
}

function balancedScore(candidate, wanted) {
    const recall = similarity(candidate, wanted);
    if (recall === 0) return 0;
    const precision = similarity(wanted, candidate);
    if (precision === 0) return 0;
    return (2 * recall * precision) / (recall + precision);
}

function seasonOrdinal(title) {
    const text = normalize(title);
    const ordinal = text.match(/\b(\d+)(?:st|nd|rd|th)?\s+season\b/);
    if (ordinal) return parseInt(ordinal[1], 10);
    const trailing = text.match(/\bseason\s+(\d+)\b/);
    if (trailing) return parseInt(trailing[1], 10);
    const roman = text.match(/\s(v?i{1,3})$/);
    if (roman) {
        const map = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
        return map[roman[1]] || 0;
    }
    return 0;
}

function dropOtherSeasons(results, titles) {
    let wanted = 0;
    for (let i = 0; i < titles.length; i++) {
        const season = seasonOrdinal(titles[i]);
        if (season > wanted) wanted = season;
    }
    if (wanted === 0) return results;
    const kept = results.filter(r => {
        const season = seasonOrdinal(r.title);
        return season === 0 || season === wanted;
    });
    return kept.length > 0 ? kept : results;
}

function narrowToBest(results, titles) {
    let best = null;
    let bestScore = 0;
    let runnerUp = 0;
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        let score = 0;
        for (let j = 0; j < titles.length; j++) {
            const value = balancedScore(result.title, titles[j]);
            if (value > score) score = value;
        }
        if (score > bestScore) {
            runnerUp = bestScore;
            bestScore = score;
            best = result;
        } else if (score > runnerUp) {
            runnerUp = score;
        }
    }
    if (best && bestScore >= 0.5 && bestScore - runnerUp >= 0.08) {
        return [best];
    }
    return results;
}

function mediaTitles(media) {
    if (!media) return [];
    return usableTitles([media.romajiTitle, media.englishTitle, ...(media.synonyms || [])]);
}

function primaryTitles(media) {
    if (!media) return [];
    return usableTitles([media.romajiTitle, media.englishTitle]);
}

function usableTitles(titles) {
    return titles.filter(title => {
        if (typeof title !== "string" || title.trim() === "") return false;
        const stripped = title.replace(/\s+/g, "");
        if (stripped.length === 0) return false;
        const latin = stripped.replace(/[^a-zA-Z0-9]/g, "").length;
        if (latin / stripped.length < 0.7) return false;
        const words = normalize(title).split(" ").filter(Boolean);
        return words.some(w => w.length >= 3 && !GENERIC_WORDS[w]);
    });
}

function bestScore(results, titles) {
    let best = 0;
    for (let i = 0; i < results.length; i++) {
        for (let j = 0; j < titles.length; j++) {
            const score = similarity(results[i].title, titles[j]);
            if (score > best) best = score;
        }
    }
    return best;
}

const HLS_HEADERS = {
    "Referer": "https://player.zilla-networks.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent": BROWSER_UA,
};

const SLOW_HOST_MS = 6000;
const MP4UPLOAD_DOWN_KEY = "av1:mp4upload:down";

const MP4UPLOAD_HEADERS = {
    "Referer": "https://www.mp4upload.com/",
    "User-Agent": BROWSER_UA,
};

async function extractMp4Upload(embedUrl) {
    if (remember(MP4UPLOAD_DOWN_KEY)) return null;
    const started = Date.now();
    try {
        const res = await fetchWithRetry(embedUrl, 0, MP4UPLOAD_HEADERS);
        if (Date.now() - started >= SLOW_HOST_MS) keep(MP4UPLOAD_DOWN_KEY, true);
        if (!res.ok) return null;
        const match = res.text().match(/src:\s*"([^"]+\.mp4[^"]*)"/);
        if (!match) return null;
        return {
            url: match[1],
            type: "mp4",
            quality: "auto",
            subtitles: [],
        };
    } catch (err) {
        keep(MP4UPLOAD_DOWN_KEY, true);
        return null;
    }
}

const PAD_BLOCK_HEX = "10101010101010101010101010101010";

function decryptAesGcm(keyHex, ivHex, dataHex) {
    if (typeof CryptoJS === "undefined" || !CryptoJS) return "";
    if (ivHex.length !== 24 || dataHex.length <= 32) return "";
    const key = CryptoJS.enc.Hex.parse(keyHex);
    const body = dataHex.slice(0, -32);
    let plain = "";
    for (let block = 0; block * 32 < body.length; block++) {
        const counter = ivHex + ("0000000" + (block + 2).toString(16)).slice(-8);
        const keystream = CryptoJS.AES.encrypt("", key, {
            iv: CryptoJS.enc.Hex.parse(xorHex(counter, PAD_BLOCK_HEX)),
        }).toString(CryptoJS.enc.Hex);
        plain += xorHex(body.slice(block * 32, block * 32 + 32), keystream);
    }
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Hex.parse(plain));
}

function xorHex(a, b) {
    let out = "";
    for (let i = 0; i < a.length; i += 2) {
        const byte = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        out += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return out;
}

function base64ToHex(value) {
    return CryptoJS.enc.Hex.stringify(CryptoJS.enc.Base64.parse(padBase64(value)));
}

function padBase64(value) {
    const std = value.replace(/-/g, "+").replace(/_/g, "/");
    return std + "===".slice((std.length + 3) % 4);
}

const VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

async function extractVoe(embedUrl) {
    try {
        let html = (await fetchWithRetry(embedUrl, 1, PLAIN_HEADERS)).text();
        const hop = html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/);
        if (hop && html.indexOf("application/json") === -1) {
            html = (await fetchWithRetry(hop[1], 1, PLAIN_HEADERS)).text();
        }
        const blob = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
        if (!blob) return [];
        const packed = JSON.parse(blob[1]);
        const info = JSON.parse(unpackVoe(Array.isArray(packed) ? packed[0] : packed));
        if (info.source) return [{ url: info.source, type: "m3u8", quality: "auto", subtitles: [] }];
        if (info.direct_access_url) {
            return [{ url: info.direct_access_url, type: "mp4", quality: "auto", subtitles: [] }];
        }
    } catch (err) {
        console.error("AnimeAV1: Voe no respondió:", err);
    }
    return [];
}

function unpackVoe(packed) {
    let text = packed.replace(/[a-zA-Z]/g, c => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
    for (let i = 0; i < VOE_MARKERS.length; i++) {
        text = text.split(VOE_MARKERS[i]).join("");
    }
    const shifted = CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Base64.parse(padBase64(text)));
    let reversed = "";
    for (let i = shifted.length - 1; i >= 0; i--) {
        reversed += String.fromCharCode(shifted.charCodeAt(i) - 3);
    }
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(padBase64(reversed)));
}

const UPNSHARE_KEY = "kiemtienmua911ca";
const UPNSHARE_IV = "1234567890oiuytr";

async function extractUpnShare(embedUrl) {
    const match = embedUrl.match(/^(https?:\/\/[^/#?]+)[^#]*#(.+)$/);
    if (!match) return [];
    const api = `${match[1]}/api/v1/video?id=${encodeURIComponent(match[2])}`;
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetchWithRetry(api, 1, upnShareHeaders(embedUrl));
            if (!res.ok) return [];
            const plain = CryptoJS.AES.decrypt(
                CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(res.text().trim())),
                CryptoJS.enc.Utf8.parse(UPNSHARE_KEY),
                { iv: CryptoJS.enc.Utf8.parse(UPNSHARE_IV) }
            ).toString(CryptoJS.enc.Utf8);
            const url = JSON.parse(plain).cfNative;
            if (url) return [{ url, type: "m3u8", quality: "auto", subtitles: [] }];
        }
    } catch (err) {
        console.error("AnimeAV1: UPNShare no respondió:", err);
    }
    return [];
}

function upnShareHeaders(embedUrl) {
    const origin = embedUrl.match(/^https?:\/\/[^/#?]+/);
    return {
        "Referer": origin ? `${origin[0]}/` : embedUrl,
        "User-Agent": BROWSER_UA,
    };
}

async function extractByse(embedUrl) {
    const match = embedUrl.match(/^(https?:\/\/[^/]+)\/[a-z]\/([A-Za-z0-9]+)/);
    if (!match) return [];
    try {
        const res = await fetchWithRetry(`${match[1]}/api/videos/${match[2]}`, 1, PLAIN_HEADERS);
        if (!res.ok) return [];
        const playback = res.json().playback;
        if (!playback || !Array.isArray(playback.key_parts)) return [];
        const plain = decryptAesGcm(
            byseKeyParts(playback).map(part => base64ToHex(part)).join(""),
            base64ToHex(playback.iv),
            base64ToHex(playback.payload)
        );
        if (!plain) return [];
        const sources = JSON.parse(plain).sources || [];
        return sources
            .filter(s => s && typeof s.url === "string")
            .map((s, i) => ({
                url: s.url,
                type: String(s.mime_type || "").indexOf("mpegurl") !== -1 ? "m3u8" : "mp4",
                quality: s.label || (s.height && `${s.height}p`) || `auto ${i + 1}`,
                subtitles: [],
            }));
    } catch (err) {
        console.error("AnimeAV1: Byse no respondió:", err);
    }
    return [];
}

function byseKeyParts(playback) {
    const parts = playback.key_parts;
    const version = String(playback.version || "").trim();
    const first = /^\d+$/.test(version) ? parseInt(version, 10) : 0;
    const second = 31 - first;
    if (first < 1 || first > 20 || first > parts.length || second > parts.length) {
        return parts;
    }
    return [parts[first - 1], parts[second - 1]];
}

class Provider {
    baseUrl = "https://animeav1.com";

    getSettings() {
        return {
            episodeServers: ["Voe", "Byse", "MP4Upload", "UPNShare", "HLS"],
            supportsDub: true,
        };
    }

    buildAnimeId(slug, isDub) {
        return JSON.stringify({ slug, type: isDub ? "dub" : "sub" });
    }

    _resolveRemixData(json, isDub) {
        if (!json || !json.nodes) return [];
        for (let i = 0; i < json.nodes.length; i++) {
            const node = json.nodes[i];
            if (node && node.uses && node.uses.search_params) {
                const data = node.data;
                if (!data || data.length === 0) continue;
                const rootConfig = data[0];
                if (!rootConfig || typeof rootConfig.results !== "number") continue;
                const animePointers = data[rootConfig.results];
                if (!Array.isArray(animePointers)) continue;
                const results = [];
                for (let j = 0; j < animePointers.length; j++) {
                    const pointer = animePointers[j];
                    const rawObj = data[pointer];
                    if (!rawObj) continue;
                    const title = data[rawObj.title];
                    const slug = data[rawObj.slug];
                    if (!title || !slug) continue;
                    results.push({
                        id: this.buildAnimeId(slug, isDub),
                        title: title,
                        url: `${this.baseUrl}/media/${slug}`,
                        subOrDub: isDub ? "dub" : "sub",
                    });
                }
                return results;
            }
        }
        return [];
    }

    async searchOnce(query, isDub) {
        const key = `av1:search:${isDub ? "dub" : "sub"}:${normalize(query)}`;
        const cached = remember(key);
        if (cached) return cached;
        const params = new URLSearchParams();
        params.append("page", "1");
        if (query && query.trim() !== "") params.append("search", query);
        const res = await fetchWithRetry(`${this.baseUrl}/catalogo/__data.json?${params.toString()}`);
        if (!res.ok) return [];
        const results = this._resolveRemixData(res.json(), isDub);
        keep(key, results);
        return results;
    }

    async search(opts) {
        const isDub = !!opts.dub;
        const titles = mediaTitles(opts.media);
        const primary = primaryTitles(opts.media);
        const narrow = (opts.media && opts.media.format || "").toUpperCase() !== "MOVIE";
        const cacheKey = opts.media && opts.media.id
            ? `av1:media:${opts.media.id}:${isDub ? "dub" : "sub"}`
            : "";
        const cached = cacheKey ? remember(cacheKey) : undefined;
        if (cached) return cached;
        try {
            const results = await this.searchOnce(opts.query, isDub);
            if (titles.length === 0) return results;
            if (bestScore(results, primary) >= 0.6) {
                const kept = dropOtherSeasons(results, titles);
                const picked = narrow ? narrowToBest(kept, primary) : kept;
                if (cacheKey) keep(cacheKey, picked);
                return picked;
            }
            const seen = {};
            const merged = [];
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (seen[r.id]) continue;
                seen[r.id] = true;
                merged.push(r);
            }
            const tried = [normalize(opts.query)];
            for (let i = 0; i < Math.min(titles.length, 3); i++) {
                const title = titles[i];
                const key = normalize(title);
                if (tried.indexOf(key) !== -1) continue;
                tried.push(key);
                const extra = await this.searchOnce(title, isDub);
                for (let j = 0; j < extra.length; j++) {
                    const r = extra[j];
                    if (seen[r.id]) continue;
                    seen[r.id] = true;
                    merged.push(r);
                }
                if (bestScore(merged, primary) >= 0.6) break;
            }
            const kept = dropOtherSeasons(merged, titles);
            const picked = narrow ? narrowToBest(kept, primary) : kept;
            if (cacheKey) keep(cacheKey, picked);
            return picked;
        } catch (err) {
            console.error("Error searching AnimeAV1:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        let slug;
        let type = "sub";
        try {
            const parsed = JSON.parse(id);
            slug = parsed.slug;
            if (parsed.type) type = parsed.type;
        } catch {
            slug = id;
        }
        const url = `${this.baseUrl}/media/${slug}/__data.json`;
        try {
            const res = await fetchWithRetry(url);
            if (!res.ok) throw new Error("Error fetching episodes");
            const json = res.json();
            const nodes = json.nodes || [];
            let data = null;
            let mediaDescriptor = null;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node || !node.data) continue;
                for (let j = 0; j < node.data.length; j++) {
                    const obj = node.data[j];
                    if (obj && typeof obj === "object" && "slug" in obj && "episodes" in obj) {
                        const slugPointer = obj.slug;
                        if (typeof slugPointer === "number" && node.data[slugPointer] === slug) {
                            data = node.data;
                            mediaDescriptor = obj;
                            break;
                        }
                    }
                }
                if (data) break;
            }
            if (!data || !mediaDescriptor) throw new Error("Anime no encontrado");
            const episodeIndexes = data[mediaDescriptor.episodes];
            if (!Array.isArray(episodeIndexes)) throw new Error("Lista inválida");
            const episodes = [];
            for (let i = 0; i < episodeIndexes.length; i++) {
                const epIdx = episodeIndexes[i];
                const ep = data[epIdx];
                if (!ep) continue;
                let number = i + 1;
                if (typeof ep.number === "number") {
                    const resolved = data[ep.number];
                    if (typeof resolved === "number") number = resolved;
                }
                if (!Number.isInteger(number) || number <= 0) continue;
                let title = `Episodio ${number}`;
                if (typeof ep.title === "number") {
                    title = data[ep.title];
                } else if (ep.title) {
                    title = ep.title;
                }
                episodes.push({
                    id: JSON.stringify({ slug, number, type }),
                    number,
                    title,
                    url: `${this.baseUrl}/media/${slug}/${number}`,
                });
            }
            if (type === "dub" && episodes.length > 0 && !(await this.hasDub(slug, episodes[0].number))) {
                console.error(`AnimeAV1: ${slug} no tiene doblaje, se usa el sub`);
                return episodes.map(episode => ({
                    ...episode,
                    id: JSON.stringify({ slug, number: episode.number, type: "sub" }),
                }));
            }
            return episodes;
        } catch (err) {
            console.error("Error finding episodes:", err);
            return [];
        }
    }

    async episodeEmbeds(slug, number) {
        const key = `av1:ep:${slug}:${number}`;
        const cached = remember(key);
        if (cached) return cached;
        const res = await fetchWithRetry(`${this.baseUrl}/media/${slug}/${number}/__data.json`);
        if (!res.ok) return null;
        const json = res.json();
        for (const node of json?.nodes || []) {
            if (!node || !node.data) continue;
            const root = node.data.find(item => item && typeof item === "object" && "embeds" in item);
            if (root) {
                const found = { data: node.data, embeds: node.data[root.embeds] || {} };
                keep(key, found);
                return found;
            }
        }
        return null;
    }

    async audioTracks(slug, number) {
        const found = await this.episodeEmbeds(slug, number);
        return found ? Object.keys(found.embeds) : [];
    }

    async hasDub(slug, number) {
        const key = `av1:dub:${slug}`;
        const cached = remember(key);
        if (cached !== undefined) return cached;
        const dubbed = (await this.audioTracks(slug, number)).indexOf("DUB") !== -1;
        keep(key, dubbed);
        return dubbed;
    }

    async findEpisodeServer(episode, server) {
        const rawId = typeof episode === "string" ? episode : episode.id;
        let slug;
        let number;
        let type = "sub";
        try {
            const parsed = JSON.parse(rawId);
            slug = parsed.slug;
            number = parsed.number;
            if (parsed.type) type = parsed.type;
        } catch {
            throw new Error("ID inválido");
        }
        try {
            const found = await this.episodeEmbeds(slug, number);
            if (!found) throw new Error("No se encontraron servidores");
            const data = found.data;
            const embeds = found.embeds;
            const category = type.toUpperCase();
            let listIndex = embeds[category];
            if (typeof listIndex !== "number" && category === "DUB") {
                listIndex = embeds["SUB"];
                if (typeof listIndex === "number") {
                    console.error(`AnimeAV1: ${slug} ${number} sin doblaje, se usa el sub`);
                }
            }
            if (typeof listIndex !== "number") {
                throw new Error(`No hay contenido en ${category}`);
            }
            const serverList = data[listIndex];
            if (!Array.isArray(serverList)) throw new Error("Lista vacía");
            const wanted = (server || "HLS").trim().toUpperCase();
            let embedUrl = null;
            let serverName = null;
            for (let i = 0; i < serverList.length; i++) {
                const ptr = serverList[i];
                const entry = data[ptr];
                if (!entry) continue;
                const name = data[entry.server];
                const link = data[entry.url];
                if (!name || !link) continue;
                if (String(name).trim().toUpperCase() === wanted) {
                    embedUrl = link;
                    serverName = name;
                    break;
                }
            }
            if (!embedUrl || !serverName) {
                throw new Error(`No se encontró servidor ${server} para ${type}`);
            }
            let sources = [];
            let headers = {};
            if (wanted === "HLS") {
                sources = [{
                    url: embedUrl.replace("/play/", "/m3u8/"),
                    type: "m3u8",
                    quality: "auto",
                    subtitles: [],
                }];
                headers = HLS_HEADERS;
            } else if (wanted === "UPNSHARE") {
                sources = await extractUpnShare(embedUrl);
                headers = upnShareHeaders(embedUrl);
            } else if (wanted === "BYSE") {
                sources = await extractByse(embedUrl);
                headers = PLAIN_HEADERS;
            } else if (wanted === "VOE") {
                sources = await extractVoe(embedUrl);
                headers = PLAIN_HEADERS;
            } else if (wanted === "MP4UPLOAD") {
                const source = await extractMp4Upload(embedUrl);
                if (source) sources = [source];
                headers = MP4UPLOAD_HEADERS;
            }
            if (sources.length === 0) {
                throw new Error(`No se pudo extraer el video de ${serverName}`);
            }
            return {
                server: serverName,
                headers,
                videoSources: sources,
            };
        } catch (err) {
            console.error("Error finding episode server:", err);
            throw err;
        }
    }
}
