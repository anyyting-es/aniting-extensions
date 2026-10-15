const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: [
                "Server 1 [Sub]",
                "Server 1 [Latino]",
                "Server 1 [Castellano]",
                "Server 2 [Sub]",
                "Server 2 [Latino]",
                "Server 2 [Castellano]"
            ],
            supportsDub: true,
        };
    }

    async search(opts) {
        const query = (opts.query || "").trim();
        if (!query) return [];

        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];

            const data = await res.json();
            const results = data.results || [];

            return results.map(anime => ({
                id: String(anime.id),
                title: anime.title,
                url: `${API_BASE}/episodes?animeId=${anime.id}`,
                subOrDub: "both"
            }));
        } catch (err) {
            console.error("Aniting Multi-Audio search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const res = await fetch(`${API_BASE}/episodes?animeId=${encodeURIComponent(id)}`);
            if (!res.ok) return [];

            const data = await res.json();
            const episodes = data.episodes || [];

            return episodes.map(ep => ({
                id: JSON.stringify({ animeId: id, epNum: ep.num }),
                number: ep.num,
                title: `Episodio ${ep.num}`,
                url: `${API_BASE}/streams?animeId=${id}&ep=${ep.num}`
            }));
        } catch (err) {
            console.error("Aniting Multi-Audio findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        let animeId;
        let epNum = 1;

        try {
            const parsed = JSON.parse(episode.id);
            animeId = parsed.animeId;
            epNum = parsed.epNum;
        } catch (_) {
            animeId = episode.id;
        }

        const res = await fetch(`${API_BASE}/streams?animeId=${encodeURIComponent(animeId)}&ep=${encodeURIComponent(epNum)}`);
        if (!res.ok) {
            throw new Error("No se pudo conectar con el servidor de streaming");
        }

        const data = await res.json();
        const streams = data.streams || [];

        let chosen = streams.find(s => s.server.toLowerCase() === (server || "").toLowerCase());
        if (!chosen && streams.length > 0) {
            chosen = streams[0];
        }

        if (!chosen) {
            throw new Error(`Servidor no disponible para el episodio ${epNum}`);
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
