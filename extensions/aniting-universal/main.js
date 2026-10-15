const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: [
                "Auto",
                "Server HD [SUB]",
                "Server 1 [Latino]",
                "Server 1 [Castellano]",
                "Server 1 [Sub]",
                "Server 2 [Latino]",
                "Server 2 [Sub]"
            ],
            supportsDub: true,
        };
    }

    async search(opts) {
        const media = opts.media;
        let results = [];

        // 1. Prioritize direct AniList / MAL match
        if (media && media.id) {
            try {
                const res = await fetch(`${API_BASE}/hd/search?anilist=${media.id}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.results && data.results.length > 0) {
                        return data.results.map(item => ({
                            id: JSON.stringify({ type: "hd", id: item.id }),
                            title: item.title,
                            url: item.url,
                            subOrDub: "both"
                        }));
                    }
                }
            } catch (_) {}
        }

        // 2. Query search
        const query = (opts.query || (media && (media.romajiTitle || media.englishTitle)) || "").trim();
        if (!query) return [];

        try {
            // Search in parallel in both catalogs
            const [hdRes, dbRes] = await Promise.allSettled([
                fetch(`${API_BASE}/hd/search?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : null),
                fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : null)
            ]);

            const seen = new Set();

            if (hdRes.status === "fulfilled" && hdRes.value && hdRes.value.results) {
                for (const item of hdRes.value.results) {
                    const titleKey = item.title.toLowerCase();
                    if (!seen.has(titleKey)) {
                        seen.add(titleKey);
                        results.push({
                            id: JSON.stringify({ type: "hd", id: item.id }),
                            title: item.title,
                            url: item.url,
                            subOrDub: "both"
                        });
                    }
                }
            }

            if (dbRes.status === "fulfilled" && dbRes.value && dbRes.value.results) {
                for (const item of dbRes.value.results) {
                    const titleKey = item.title.toLowerCase();
                    if (!seen.has(titleKey)) {
                        seen.add(titleKey);
                        results.push({
                            id: JSON.stringify({ type: "db", id: String(item.id), title: item.title }),
                            title: item.title,
                            url: `${API_BASE}/episodes?animeId=${item.id}`,
                            subOrDub: "both"
                        });
                    }
                }
            }

            return results;
        } catch (err) {
            console.error("Aniting Universal search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        let meta = { type: "hd", id: id };
        try {
            meta = JSON.parse(id);
        } catch (_) {}

        try {
            if (meta.type === "db") {
                const res = await fetch(`${API_BASE}/episodes?animeId=${encodeURIComponent(meta.id)}`);
                if (!res.ok) return [];
                const data = await res.json();
                return (data.episodes || []).map(ep => ({
                    id: JSON.stringify({ type: "db", id: meta.id, ep: ep.num, title: meta.title }),
                    number: ep.num,
                    title: `Episodio ${ep.num}`,
                    url: `${API_BASE}/universal/streams?animeId=${meta.id}&ep=${ep.num}`
                }));
            } else {
                const res = await fetch(`${API_BASE}/hd/episodes?id=${encodeURIComponent(meta.id)}`);
                if (!res.ok) return [];
                const data = await res.json();
                return (data.episodes || []).map(ep => ({
                    id: JSON.stringify({ type: "hd", id: meta.id, ep: ep.number }),
                    number: ep.number,
                    title: ep.title ? `Episodio ${ep.number} - ${ep.title}` : `Episodio ${ep.number}`,
                    url: `${API_BASE}/universal/streams?id=${meta.id}&ep=${ep.number}`
                }));
            }
        } catch (err) {
            console.error("Aniting Universal findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        let animeId = "";
        let epNum = 1;
        let title = "";

        try {
            const parsed = JSON.parse(episode.id);
            animeId = parsed.id || "";
            epNum = parsed.ep || episode.number || 1;
            title = parsed.title || "";
        } catch (_) {
            animeId = String(episode.id);
            epNum = episode.number || 1;
        }

        let queryUrl = `${API_BASE}/universal/streams?ep=${epNum}`;
        if (animeId) queryUrl += `&id=${encodeURIComponent(animeId)}`;
        if (title) queryUrl += `&title=${encodeURIComponent(title)}`;
        if (server && server !== "Auto") queryUrl += `&server=${encodeURIComponent(server)}`;

        const res = await fetch(queryUrl);
        if (!res.ok) {
            throw new Error("No se pudo obtener la transmisión desde el servidor universal.");
        }

        const data = await res.json();
        const streams = data.streams || [];
        if (streams.length === 0) {
            throw new Error(`Servidor no disponible para el episodio ${epNum}`);
        }

        // Auto selection selects highest quality or requested server
        let chosen = streams[0];
        if (server && server !== "Auto") {
            const match = streams.find(s => s.server.toLowerCase() === server.toLowerCase());
            if (match) chosen = match;
        }

        return {
            server: chosen.server || "Aniting Universal",
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
