const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: ["Server HD [SUB]", "Server HD [DUB]"],
            supportsDub: true,
        };
    }

    async search(opts) {
        const media = opts.media;
        let url = "";

        if (media && media.id) {
            url = `${API_BASE}/hd/search?anilist=${media.id}`;
        } else if (media && media.idMal) {
            url = `${API_BASE}/hd/search?mal=${media.idMal}`;
        } else {
            const query = (opts.query || (media && (media.romajiTitle || media.englishTitle)) || "").trim();
            if (!query) return [];
            url = `${API_BASE}/hd/search?q=${encodeURIComponent(query)}`;
        }

        try {
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return data.results || [];
        } catch (err) {
            console.error("Aniting Ultra HD search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const res = await fetch(`${API_BASE}/hd/episodes?id=${encodeURIComponent(id)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.episodes || [];
        } catch (err) {
            console.error("Aniting Ultra HD findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        let anilistId;
        let epNum = 1;

        if (String(episode.id).includes("$")) {
            const parts = episode.id.split("$");
            anilistId = parts[0];
            epNum = parts[1] || String(episode.number);
        } else {
            anilistId = episode.id;
            epNum = String(episode.number);
        }

        const isDub = (server || "").toLowerCase().includes("dub");
        const lang = isDub ? "dub" : "sub";

        const res = await fetch(`${API_BASE}/hd/streams?id=${encodeURIComponent(anilistId)}&ep=${encodeURIComponent(epNum)}&lang=${lang}`);
        if (!res.ok) {
            throw new Error("No se pudo obtener la transmisión desde el servidor");
        }

        const data = await res.json();
        const streams = data.streams || [];
        if (streams.length === 0) {
            throw new Error(`Servidor no disponible para el episodio ${epNum}`);
        }

        const stream = streams[0];
        return {
            server: stream.server || (isDub ? "Server HD [DUB]" : "Server HD [SUB]"),
            headers: stream.headers || {},
            videoSources: [
                {
                    url: stream.url,
                    type: "m3u8",
                    quality: stream.quality || "1080p",
                    subtitles: stream.subtitles || []
                }
            ]
        };
    }
}
