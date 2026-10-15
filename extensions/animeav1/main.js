const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: ["Auto", "Server HD [SUB]", "Server HD [English Dub]"],
            supportsDub: true,
        };
    }

    async search(opts) {
        const media = opts.media;
        if (media && media.id) {
            try {
                const res = await fetch(`${API_BASE}/hd/search?anilist=${media.id}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.results && data.results.length > 0) {
                        return data.results.map(item => ({
                            id: String(item.id),
                            title: item.title,
                            url: item.url,
                            subOrDub: "both"
                        }));
                    }
                }
            } catch (_) {}
        }

        const query = (opts.query || (media && (media.romajiTitle || media.englishTitle)) || "").trim();
        if (!query) return [];

        try {
            const res = await fetch(`${API_BASE}/hd/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map(item => ({
                id: String(item.id),
                title: item.title,
                url: item.url,
                subOrDub: "both"
            }));
        } catch (err) {
            console.error("[AnimeAV1] search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const res = await fetch(`${API_BASE}/hd/episodes?id=${encodeURIComponent(id)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.episodes || []).map(ep => ({
                id: `${id}$${ep.number}`,
                number: ep.number,
                title: ep.title ? `Episodio ${ep.number} - ${ep.title}` : `Episodio ${ep.number}`,
                url: `${API_BASE}/hd/streams?id=${encodeURIComponent(id)}&ep=${ep.number}`
            }));
        } catch (err) {
            console.error("[AnimeAV1] findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        const parts = episode.id.split("$");
        const animeId = parts[0];
        const epNum = parts[1] || episode.number || 1;

        let queryUrl = `${API_BASE}/hd/streams?id=${encodeURIComponent(animeId)}&ep=${epNum}`;
        const isDub = server && server.toLowerCase().includes("dub");
        if (isDub) {
            queryUrl += "&lang=dub";
        }
        if (server && server !== "Auto") {
            queryUrl += `&server=${encodeURIComponent(server)}`;
        }

        const res = await fetch(queryUrl);
        if (!res.ok) {
            throw new Error(`[AnimeAV1] Error HTTP ${res.status} al consultar streams`);
        }

        const data = await res.json();
        const streams = data.streams || [];
        if (streams.length === 0) {
            throw new Error(`[AnimeAV1] No hay fuentes para episodio ${epNum}`);
        }

        let chosen = streams[0];
        if (server && server !== "Auto") {
            const match = streams.find(s => s.server.toLowerCase() === server.toLowerCase());
            if (match) chosen = match;
        }

        return {
            server: chosen.server || (isDub ? "Server HD [English Dub]" : "Server HD [SUB]"),
            headers: chosen.headers || {},
            videoSources: [
                {
                    url: chosen.url,
                    type: "m3u8",
                    quality: chosen.quality || "1080p",
                    subtitles: data.subtitles || chosen.subtitles || []
                }
            ]
        };
    }
}
