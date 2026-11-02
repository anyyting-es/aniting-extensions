// Torrentio — torrent indexer for movies & series (Stremio addon).
//
// This is an ANIME TORRENT provider, not an onlinestream provider: Torrentio
// returns `infoHash` / magnet links, and Aniting's torrent engine is what turns
// them into a playable stream. It searches Cinemeta by title to resolve the
// IMDb id Torrentio needs, then maps its streams to AnimeTorrent entries.

const CINEMETA = "https://v3-cinemeta.strem.io";
const TORRENTIO = "https://torrentio.strem.fun";

class Provider {
    getSettings() {
        return {
            canSmartSearch: true,
            smartSearchFilters: ["episodeNumber", "resolution", "query"],
            supportsAdult: false,
            type: "main",
        };
    }

    async search(opts) {
        const media = opts.media || {};
        const query = this.queryFromOpts(opts);
        if (!query) return [];
        return this.findTorrents(query, media, 1, "");
    }

    async smartSearch(opts) {
        const media = opts.media || {};
        const query = this.queryFromOpts(opts);
        if (!query) return [];
        const episode = Number(opts.episodeNumber) > 0 ? Number(opts.episodeNumber) : 1;
        return this.findTorrents(query, media, episode, String(opts.resolution || ""));
    }

    getLatest() {
        return [];
    }

    getTorrentInfoHash(torrent) {
        return String((torrent && torrent.infoHash) || "");
    }

    getTorrentMagnetLink(torrent) {
        return String((torrent && torrent.magnetLink) || "");
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

    titles(query, media) {
        const out = [];
        const add = (value) => {
            const text = String(value || "").trim();
            if (text && out.indexOf(text) === -1) out.push(text);
        };
        add(query);
        add(media.englishTitle);
        add(media.romajiTitle);
        if (Array.isArray(media.synonyms)) {
            for (const synonym of media.synonyms) add(synonym);
        }
        return out.slice(0, 4);
    }

    async findTorrents(query, media, episode, resolution) {
        const isMovie = String(media.format || "").toUpperCase() === "MOVIE";
        const metas = await this.searchCinemeta(this.titles(query, media), isMovie);
        const out = [];
        const seen = {};

        for (const meta of metas.slice(0, 6)) {
            const streams = await this.torrentioStreams(meta, episode);
            for (const stream of streams) {
                const torrent = this.toTorrent(stream, meta, episode);
                if (!torrent) continue;
                if (resolution && torrent.resolution && !torrent.resolution.startsWith(resolution)) {
                    continue;
                }
                const key = torrent.infoHash || torrent.name;
                if (seen[key]) continue;
                seen[key] = true;
                out.push(torrent);
            }
            if (out.length >= 50) break;
        }
        return out;
    }

    async searchCinemeta(titles, isMovie) {
        const out = [];
        const seen = {};
        const types = isMovie ? ["movie"] : ["series"];

        for (const title of titles) {
            for (const type of types) {
                const url = `${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;
                const data = await this.getJson(url);
                const metas = (data && data.metas) || [];
                for (const meta of metas) {
                    if (!meta || !meta.id || seen[meta.id]) continue;
                    seen[meta.id] = true;
                    out.push({
                        id: String(meta.id),
                        name: String(meta.name || title),
                        type: meta.type === "movie" ? "movie" : "series",
                        releaseInfo: String(meta.releaseInfo || ""),
                    });
                }
            }
        }
        return out;
    }

    async torrentioStreams(meta, episode) {
        const type = meta.type === "movie" ? "movie" : "series";
        const id = type === "movie" ? meta.id : `${meta.id}:1:${episode}`;
        const data = await this.getJson(`${TORRENTIO}/stream/${type}/${id}.json`);
        return (data && data.streams) || [];
    }

    // ---------------------------------------------------------------- mapping

    toTorrent(stream, meta, episode) {
        if (!stream) return null;

        const hints = stream.behaviorHints || {};
        const filename = String(hints.filename || "").trim();
        const firstTitleLine = String(stream.title || "").split("\n")[0].trim();
        const name = filename || firstTitleLine;
        if (!name) return null;

        const infoHash = this.infoHashOf(stream);
        if (!infoHash) return null;

        const magnet = String(stream.url || "").indexOf("magnet:") === 0
            ? String(stream.url)
            : `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;

        const text = `${stream.name || ""}\n${stream.title || ""}`;
        const isMovie = meta.type === "movie";

        return {
            provider: "torrentio",
            name: name,
            date: new Date().toISOString(),
            size: this.parseSize(text),
            formattedSize: "",
            seeders: this.parseSeeders(text),
            leechers: 0,
            downloadCount: 0,
            link: "",
            downloadUrl: "",
            magnetLink: magnet,
            infoHash: infoHash,
            resolution: this.parseResolution(name + " " + text),
            isBatch: /(?:season\s*\d+|complete|batch|episodes?\s*\d+\s*-\s*\d+)/i.test(name),
            episodeNumber: isMovie ? 1 : episode,
            releaseGroup: "",
            isBestRelease: false,
            confirmed: false,
        };
    }

    infoHashOf(stream) {
        const hash = String(stream.infoHash || "").trim();
        if (hash) return hash;
        const magnet = String(stream.url || "");
        const match = magnet.match(/btih:([a-zA-Z0-9]+)/);
        return match ? match[1] : "";
    }

    parseSize(text) {
        const match = String(text || "").match(/(?:💾\s*)?([\d.,]+)\s*(TB|GB|MB|KB)/i);
        if (!match) return 0;
        const value = parseFloat(match[1].replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) return 0;
        const unit = match[2].toUpperCase();
        const multiplier = unit === "TB" ? 1024 * 1024 * 1024 * 1024
            : unit === "GB" ? 1024 * 1024 * 1024
            : unit === "MB" ? 1024 * 1024
            : 1024;
        return Math.round(value * multiplier);
    }

    parseSeeders(text) {
        const match = String(text || "").match(/👤\s*([\d,.]+)/);
        if (!match) return 0;
        return parseInt(match[1].replace(/[.,]/g, ""), 10) || 0;
    }

    parseResolution(text) {
        const match = String(text || "").match(/(2160p|4k|1080p|720p|480p|360p)/i);
        if (!match) return "";
        const value = match[1].toLowerCase();
        return value === "4k" ? "2160p" : value;
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
