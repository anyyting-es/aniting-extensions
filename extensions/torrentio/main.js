// Torrentio — TMDB movies & series streaming provider.
//
// Torrentio (the Stremio addon) does not return playable HTTP streams: it returns
// `infoHash` / `fileIdx`. Each result is therefore exposed as a `torrent` video
// source, and Aniting resolves it with its own torrent engine, playing the local
// `/api/v1/torrentstream/stream/...` endpoint.
//
// The provider only serves TMDB media (`providerType: "tmdb"`). It prefers the
// IMDb id passed by the app (`media.imdbId`) and falls back to resolving it
// through Cinemeta by title (used by manual search).
//
// Reference: https://torrentio.strem.fun

const CINEMETA = "https://v3-cinemeta.strem.io";
const TORRENTIO = "https://torrentio.strem.fun";
const MAX_EPISODES = 200;

class Provider {
    getSettings() {
        return {
            episodeServers: ["Torrentio"],
            supportsDub: false,
            providerType: "tmdb",
            // Legacy flag kept for older Aniting builds.
            supportsTmdb: true,
        };
    }

    async search(opts) {
        const media = opts.media || {};
        const query = this.queryFromOpts(opts);
        const isMovie =
            media.mediaType === "movie" ||
            String(media.format || "").toUpperCase() === "MOVIE";
        const explicitType = media.mediaType || media.format
            ? (isMovie ? "movie" : "series")
            : "";
        const imdb = String(media.imdbId || "").trim();
        const season = Number(media.season || 0) > 0 ? Number(media.season) : 1;
        const total = Number(media.episodeCount || 0);

        // Preferred path: the app already knows the IMDb id.
        if (imdb.indexOf("tt") === 0) {
            return [this.makeResult({
                imdb,
                type: explicitType || "series",
                season,
                total,
                title: query,
            })];
        }

        if (!query) return [];

        // Fallback: resolve title -> IMDb through Cinemeta.
        const metas = await this.searchCinemeta(query, explicitType);
        return metas.slice(0, 8).map((meta) => this.makeResult({
            imdb: meta.imdb,
            type: meta.type,
            season,
            total: meta.type === "movie" ? 1 : total,
            title: meta.title,
        }));
    }

    async findEpisodes(id) {
        const ref = this.decodeRef(id);
        if (!ref) return [];

        if (ref.type === "movie") {
            return [{ id, number: 1, url: id, title: "" }];
        }

        const total = ref.total > 0 ? ref.total : MAX_EPISODES;
        const count = Math.min(Math.max(total, 1), MAX_EPISODES);
        const out = [];
        for (let i = 1; i <= count; i++) {
            out.push({ id, number: i, url: id, title: "" });
        }
        return out;
    }

    async findEpisodeServer(episode, server) {
        const ref = this.decodeRef(episode && (episode.id || episode.url));
        if (!ref) {
            return { provider: "", server: "Torrentio", headers: {}, videoSources: [] };
        }

        const number = Number(episode.number || 1);
        const id = ref.type === "movie"
            ? ref.imdb
            : `${ref.imdb}:${ref.season}:${number}`;

        const data = await this.getJson(`${TORRENTIO}/stream/${ref.type}/${id}.json`);
        const streams = (data && data.streams) || [];

        // Torrentio sorts by quality/seeders. Keep the best torrent per quality
        // so the source picker shows 2160p / 1080p / 720p / 480p.
        const out = [];
        const seenQuality = {};
        for (const stream of streams) {
            const source = this.toVideoSource(stream);
            if (!source) continue;
            const key = source.quality || "auto";
            if (seenQuality[key]) continue;
            seenQuality[key] = true;
            out.push(source);
        }

        return {
            provider: "",
            server: "Torrentio",
            headers: {},
            videoSources: out,
        };
    }

    // ---------------------------------------------------------------- mapping

    makeResult(ref) {
        return {
            id: this.encodeRef(ref),
            title: ref.title || "Torrentio",
            url: "",
            subOrDub: "sub",
        };
    }

    // The ref is embedded in the provider id so it survives the backend cache
    // without relying on provider instance state: type|imdb|season|episodes.
    encodeRef(ref) {
        return [
            ref.type === "movie" ? "movie" : "series",
            ref.imdb,
            ref.season || 1,
            ref.total || 0,
        ].join("|");
    }

    decodeRef(value) {
        const parts = String(value || "").split("|");
        if (parts.length < 2) return null;
        const imdb = parts[1];
        if (imdb.indexOf("tt") !== 0) return null;
        return {
            type: parts[0] === "movie" ? "movie" : "series",
            imdb,
            season: Number(parts[2] || 1) || 1,
            total: Number(parts[3] || 0) || 0,
        };
    }

    toVideoSource(stream) {
        if (!stream) return null;

        const infoHash = this.infoHashOf(stream);
        if (!infoHash) return null;

        const hints = stream.behaviorHints || {};
        const text = `${stream.name || ""}\n${stream.title || ""}`;
        const filename = String(hints.filename || "").trim();
        const name = filename ||
            String(stream.title || "").split("\n")[0].trim() ||
            `Torrent ${infoHash.slice(0, 8)}`;

        const source = {
            url: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`,
            type: "torrent",
            label: name,
            quality: this.parseResolution(`${name} ${text}`),
            subtitles: [],
            infoHash,
        };

        if (typeof stream.fileIdx === "number" && stream.fileIdx >= 0) {
            source.fileIndex = stream.fileIdx;
        }

        return source;
    }

    infoHashOf(stream) {
        const hash = String(stream.infoHash || "").trim();
        if (hash) return hash;
        const match = String(stream.url || "").match(/btih:([a-zA-Z0-9]+)/);
        return match ? match[1] : "";
    }

    parseResolution(text) {
        const match = String(text || "").match(/(2160p|4k|1080p|720p|480p|360p)/i);
        if (!match) return "";
        const value = match[1].toLowerCase();
        return value === "4k" ? "2160p" : value;
    }

    // ---------------------------------------------------------------- search

    queryFromOpts(opts) {
        const media = opts.media || {};
        return String(
            opts.query ||
            media.englishTitle ||
            media.romajiTitle ||
            ""
        ).trim();
    }

    async searchCinemeta(query, forcedType) {
        const types = forcedType ? [forcedType] : ["series", "movie"];
        const out = [];
        const seen = {};

        for (const type of types) {
            const url = `${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
            const data = await this.getJson(url);
            const metas = (data && data.metas) || [];
            for (const meta of metas) {
                const imdb = String((meta && meta.id) || "");
                if (imdb.indexOf("tt") !== 0 || seen[imdb]) continue;
                seen[imdb] = true;
                out.push({
                    imdb,
                    type: meta.type === "movie" ? "movie" : type,
                    title: String(meta.name || query),
                });
            }
        }

        return out;
    }

    // ---------------------------------------------------------------- http

    async getJson(url) {
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "Aniting/1.0" },
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }
}
