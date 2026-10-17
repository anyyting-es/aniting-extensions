const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: ["Server 1 [Latino]", "Server 1 [Sub]", "Server 1 [Castellano]"],
            supportsDub: true,
        };
    }

    async search(opts) {
        const media = opts.media;
        const query = (opts.query || (media && (media.romajiTitle || media.englishTitle)) || "").trim();
        if (!query) return [];

        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map(item => ({
                id: String(item.id),
                title: item.title,
                url: `${API_BASE}/episodes?animeId=${item.id}`,
                subOrDub: "both"
            }));
        } catch (err) {
            console.error("[EspAnime] search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const res = await fetch(`${API_BASE}/episodes?animeId=${encodeURIComponent(id)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.episodes || []).map(ep => ({
                id: `${id}$${ep.num}`,
                number: ep.num,
                title: `Episodio ${ep.num}`,
                url: `${API_BASE}/streams?animeId=${encodeURIComponent(id)}&ep=${ep.num}`
            }));
        } catch (err) {
            console.error("[EspAnime] findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        const parts = episode.id.split("$");
        const animeId = parts[0];
        const epNum = parts[1] || episode.number || 1;

        const targetServer = (server || "").trim();
        let queryUrl = `${API_BASE}/streams?animeId=${encodeURIComponent(animeId)}&ep=${epNum}`;
        if (targetServer) {
            queryUrl += `&server=${encodeURIComponent(targetServer)}`;
        }

        const res = await fetch(queryUrl);
        if (!res.ok) {
            throw new Error(`[EspAnime] Error HTTP ${res.status} al consultar streams`);
        }

        const data = await res.json();
        const streams = data.streams || [];
        if (streams.length === 0) {
            throw new Error(`[EspAnime] No hay streams disponibles para el episodio ${epNum}`);
        }

        let chosen = null;
        if (targetServer) {
            chosen = streams.find(s => s.server.toLowerCase() === targetServer.toLowerCase());
        }
        if (!chosen) {
            chosen = streams[0];
        }

        return {
            server: chosen.server,
            headers: chosen.headers || {},
            videoSources: [
                {
                    url: chosen.url,
                    type: "m3u8",
                    quality: chosen.quality || "1080p",
                    subtitles: []
                }
            ]
        };
    }
}
